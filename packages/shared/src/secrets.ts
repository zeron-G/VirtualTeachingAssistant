/**
 * Secrets abstraction.
 *
 * Secrets (LLM keys, Canvas tokens, the Discord bot token) are NEVER read from
 * source or committed config. In development they come from environment
 * variables; in production they come from Azure Key Vault. Both sit behind the
 * same `SecretsProvider` interface so the rest of the system is agnostic.
 *
 * Per-course secrets (each professor brings their own Canvas token) are looked
 * up by a namespaced name, e.g. `canvas.token.<courseId>`.
 */

import { SecretMissingError } from './errors.js';
// Type-only import: erased at compile time, so the Azure SDK is NOT loaded at
// startup — KeyVaultSecretsProvider dynamic-imports it lazily on first use.
import type { SecretClient } from '@azure/keyvault-secrets';

export interface SecretsProvider {
  /** Resolve a secret by name, or `undefined` if absent. */
  get(name: string): Promise<string | undefined>;
  /** Resolve a secret by name, throwing `SecretMissingError` if absent. */
  require(name: string): Promise<string>;
}

abstract class BaseSecretsProvider implements SecretsProvider {
  abstract get(name: string): Promise<string | undefined>;

  async require(name: string): Promise<string> {
    const value = await this.get(name);
    if (value === undefined || value === '') {
      throw new SecretMissingError(name);
    }
    return value;
  }
}

/**
 * Environment-backed provider for local development.
 * Secret names are upper-cased and dots/dashes become underscores, so
 * `canvas.token.cs101` reads `CANVAS_TOKEN_CS101`.
 */
export class EnvSecretsProvider extends BaseSecretsProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    super();
  }

  get(name: string): Promise<string | undefined> {
    const key = name.toUpperCase().replace(/[.\-/]/g, '_');
    return Promise.resolve(this.env[key]);
  }
}

/**
 * Azure Key Vault-backed provider for production.
 *
 * Resolves secrets from an Azure Key Vault using `DefaultAzureCredential` (a
 * managed identity in Azure; az-CLI / env credentials locally). The Azure SDKs
 * are loaded with DYNAMIC import on first use so they never enter the bundle's
 * startup path when `SECRETS_PROVIDER=env` (the common case).
 *
 * Secret-name mapping: logical names like `discord.bot-token` are mangled to a
 * Key Vault-legal name (`^[0-9A-Za-z-]+$`) by replacing every other character
 * with `-`, e.g. `discord.bot-token` -> `discord-bot-token`,
 * `canvas.token.ai-essentials` -> `canvas-token-ai-essentials`. A missing secret
 * resolves to `undefined` (so `require` throws the uniform `SecretMissingError`);
 * any other Key Vault error propagates.
 */
export class KeyVaultSecretsProvider extends BaseSecretsProvider {
  private clientPromise: Promise<SecretClient> | undefined;

  constructor(private readonly vaultUrl: string) {
    super();
  }

  private getClient(): Promise<SecretClient> {
    if (this.clientPromise === undefined) {
      this.clientPromise = (async () => {
        const { SecretClient } = await import('@azure/keyvault-secrets');
        const { DefaultAzureCredential } = await import('@azure/identity');
        return new SecretClient(this.vaultUrl, new DefaultAzureCredential());
      })();
    }
    return this.clientPromise;
  }

  async get(name: string): Promise<string | undefined> {
    const client = await this.getClient();
    try {
      const secret = await client.getSecret(toKeyVaultName(name));
      return secret.value;
    } catch (err) {
      if (isSecretNotFound(err)) return undefined;
      throw err;
    }
  }
}

/** Mangle a logical secret name into a Key Vault-legal name (`^[0-9A-Za-z-]+$`). */
function toKeyVaultName(name: string): string {
  return name.replace(/[^0-9A-Za-z-]/g, '-');
}

/** True when a Key Vault error means "no such secret" (404 / SecretNotFound). */
function isSecretNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string } | null;
  return e?.statusCode === 404 || e?.code === 'SecretNotFound';
}

export interface SecretsProviderOptions {
  readonly provider: 'env' | 'keyvault';
  readonly vaultUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Build the appropriate secrets provider from configuration. */
export function createSecretsProvider(options: SecretsProviderOptions): SecretsProvider {
  if (options.provider === 'keyvault') {
    if (!options.vaultUrl) {
      throw new Error('SECRETS_PROVIDER=keyvault requires AZURE_KEY_VAULT_URL');
    }
    return new KeyVaultSecretsProvider(options.vaultUrl);
  }
  return new EnvSecretsProvider(options.env);
}
