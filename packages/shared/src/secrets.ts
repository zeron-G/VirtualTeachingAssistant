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
 * `canvas.token.ai-essentials` reads `CANVAS_TOKEN_AI_ESSENTIALS`.
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
 * Azure Key Vault provider — stubbed until Azure is provisioned.
 *
 * TODO(phase-0/azure): implement with `@azure/keyvault-secrets` +
 * `@azure/identity` (DefaultAzureCredential / Managed Identity). Kept as a
 * stub so the wiring exists and the swap is config-only.
 */
export class KeyVaultSecretsProvider extends BaseSecretsProvider {
  constructor(private readonly vaultUrl: string) {
    super();
  }

  get(_name: string): Promise<string | undefined> {
    throw new Error(
      `KeyVaultSecretsProvider is not implemented yet (vault: ${this.vaultUrl}). ` +
        'Use SECRETS_PROVIDER=env for local development.',
    );
  }
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
