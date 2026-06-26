/**
 * API-key resolution.
 *
 * For roles whose {@link ModelSpec} uses `auth: 'apiKey'`, this resolves the
 * concrete key from a `SecretsProvider` by the spec's `apiKeyName`. The key is
 * returned to the caller (a provider constructor) and never logged.
 */

import { ConfigError } from '@vta/shared';
import type { SecretsProvider } from '@vta/shared';
import type { ModelSpec } from './../roles.js';

/**
 * Resolve the API key named by a {@link ModelSpec} from the secrets provider.
 *
 * Throws `ConfigError` if the spec is not configured for API-key auth or has no
 * `apiKeyName`. Propagates `SecretMissingError` from `require` if the named
 * secret is absent.
 */
export async function resolveApiKey(
  spec: ModelSpec,
  secrets: SecretsProvider,
): Promise<string> {
  if (spec.auth !== 'apiKey') {
    throw new ConfigError('resolveApiKey called for a spec that does not use apiKey auth', {
      provider: spec.provider,
      auth: spec.auth,
    });
  }
  if (!spec.apiKeyName) {
    throw new ConfigError('ModelSpec uses apiKey auth but has no apiKeyName', {
      provider: spec.provider,
      model: spec.model,
    });
  }
  return secrets.require(spec.apiKeyName);
}
