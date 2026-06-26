/**
 * Codex OAuth token helper.
 *
 * In the `dev` profile, OpenAI requests authenticate with the access token that
 * the Codex CLI persists in `~/.codex/auth.json`, rather than a managed API
 * key. This helper reads that file, inspects the JWT `exp` claim, refreshes the
 * token against OpenAI's OAuth token endpoint when it is near expiry, and hands
 * out a valid bearer token via {@link CodexOAuth.getAccessToken}.
 *
 * SECURITY: tokens are NEVER logged. Only non-sensitive metadata (expiry,
 * whether a refresh happened) may be logged by callers.
 *
 * TODO(verify-at-install): The on-disk shape of `~/.codex/auth.json`, the OAuth
 * token endpoint URL, the client_id, and the refresh request/response shape are
 * all ASSUMED here and MUST be verified against the installed Codex CLI version
 * before relying on refresh in any real environment. The assumptions are
 * isolated in `AuthFile`, `DEFAULT_TOKEN_ENDPOINT`, `DEFAULT_CLIENT_ID`, and
 * `refresh()` so they are cheap to correct.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, LlmUnavailableError, toError } from '@vta/shared';

/**
 * Assumed structure of `~/.codex/auth.json`.
 * TODO(verify-at-install): confirm field names against the Codex CLI.
 */
interface AuthFile {
  /** Current bearer access token (a JWT). */
  access_token?: string;
  /** Refresh token used to mint a new access token. */
  refresh_token?: string;
  /** Optional id token (unused here, kept for round-tripping). */
  id_token?: string;
  /** Optional absolute expiry (epoch seconds) if the file records one. */
  expires_at?: number;
}

/**
 * TODO(verify-at-install): confirm OpenAI's OAuth token endpoint + client id
 * used by the Codex CLI. These defaults are placeholders.
 */
const DEFAULT_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const DEFAULT_CLIENT_ID = 'codex-cli';

/** Refresh when the token has this many seconds (or fewer) of life left. */
const REFRESH_SKEW_SECONDS = 120;

export interface CodexOAuthOptions {
  /** Override the auth file path (defaults to ~/.codex/auth.json). */
  readonly authFilePath?: string;
  /** Override the OAuth token endpoint. */
  readonly tokenEndpoint?: string;
  /** Override the OAuth client id. */
  readonly clientId?: string;
}

/** Decode the `exp` (epoch seconds) claim from a JWT without verifying it. */
function decodeJwtExp(jwt: string): number | undefined {
  const parts = jwt.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined || payload.length === 0) {
    return undefined;
  }
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp : undefined;
  } catch {
    // Malformed payload — treat as "no known expiry" so callers refresh.
    return undefined;
  }
}

export class CodexOAuth {
  private readonly authFilePath: string;
  private readonly tokenEndpoint: string;
  private readonly clientId: string;

  /** Cached token + its absolute expiry (epoch seconds), populated lazily. */
  private cachedToken: string | undefined;
  private cachedExp: number | undefined;

  constructor(options: CodexOAuthOptions = {}) {
    this.authFilePath = options.authFilePath ?? join(homedir(), '.codex', 'auth.json');
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
    this.clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  }

  /**
   * Return a valid access token, refreshing transparently if the cached/on-disk
   * token is missing or within {@link REFRESH_SKEW_SECONDS} of expiry.
   */
  async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.cachedToken && this.cachedExp && this.cachedExp - now > REFRESH_SKEW_SECONDS) {
      return this.cachedToken;
    }

    const file = await this.readAuthFile();
    const token = file.access_token;
    if (token) {
      const exp = file.expires_at ?? decodeJwtExp(token);
      if (exp === undefined || exp - now > REFRESH_SKEW_SECONDS) {
        // Either no known expiry (assume fresh) or comfortably valid.
        this.cachedToken = token;
        this.cachedExp = exp;
        return token;
      }
    }

    // Token absent or near/at expiry → refresh.
    if (!file.refresh_token) {
      throw new ConfigError(
        'Codex auth file has no usable access_token and no refresh_token. ' +
          'Log in with the Codex CLI, or use the prod profile with API keys.',
        { authFilePath: this.authFilePath },
      );
    }
    return this.refresh(file.refresh_token);
  }

  /** Read and parse the Codex auth file. */
  private async readAuthFile(): Promise<AuthFile> {
    let raw: string;
    try {
      raw = await readFile(this.authFilePath, 'utf8');
    } catch (err) {
      throw new ConfigError(
        `Could not read Codex auth file at ${this.authFilePath}. ` +
          'Ensure the Codex CLI is installed and logged in for the dev profile.',
        { cause: toError(err).message },
      );
    }
    try {
      return JSON.parse(raw) as AuthFile;
    } catch (err) {
      throw new ConfigError(`Codex auth file at ${this.authFilePath} is not valid JSON`, {
        cause: toError(err).message,
      });
    }
  }

  /**
   * Exchange a refresh token for a new access token.
   *
   * TODO(verify-at-install): confirm grant_type, body encoding (form vs JSON),
   * and response field names against the Codex CLI / OpenAI OAuth server.
   */
  private async refresh(refreshToken: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
        }),
      });
    } catch (err) {
      // Network failure — surface as an LLM-availability problem.
      throw new LlmUnavailableError('Codex OAuth refresh request failed', {
        endpoint: this.tokenEndpoint,
        cause: toError(err).message,
      });
    }

    if (!response.ok) {
      // Do NOT include the response body — it may echo token material.
      throw new LlmUnavailableError('Codex OAuth refresh was rejected', {
        endpoint: this.tokenEndpoint,
        status: response.status,
      });
    }

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const newToken = data.access_token;
    if (!newToken) {
      throw new LlmUnavailableError('Codex OAuth refresh returned no access_token', {
        endpoint: this.tokenEndpoint,
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const exp =
      typeof data.expires_in === 'number' ? now + data.expires_in : decodeJwtExp(newToken);

    this.cachedToken = newToken;
    this.cachedExp = exp;

    // Persist the rotated tokens so other processes benefit and we do not
    // refresh on every cold start. Best-effort: a write failure is non-fatal.
    await this.persist(newToken, data.refresh_token ?? refreshToken, exp).catch(() => {
      /* ignore persistence failure; token still usable in-memory */
    });

    return newToken;
  }

  /** Write rotated tokens back to the auth file. Never logs token values. */
  private async persist(
    accessToken: string,
    refreshToken: string,
    expiresAt: number | undefined,
  ): Promise<void> {
    const payload: AuthFile = {
      access_token: accessToken,
      refresh_token: refreshToken,
      ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
    };
    await writeFile(this.authFilePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }
}
