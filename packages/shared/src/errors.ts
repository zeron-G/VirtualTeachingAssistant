/**
 * Typed error hierarchy shared across all VTA packages.
 *
 * Every error carries a stable, machine-readable `code` so adapters and the
 * audit log can classify failures without string-matching messages. Governance
 * decisions (a blocked tool call, a refused answer) are modelled as errors so
 * they cannot be silently swallowed.
 */

export type VtaErrorCode =
  | 'CONFIG_INVALID'
  | 'SECRET_MISSING'
  | 'NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'TOOL_DENIED'
  | 'POLICY_VIOLATION'
  | 'GROUNDING_FAILED'
  | 'LLM_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Base class for every error intentionally raised inside VTA. */
export class VtaError extends Error {
  readonly code: VtaErrorCode;
  /** Optional structured context for logs (must be pre-redacted of PII). */
  readonly context?: Record<string, unknown>;

  constructor(code: VtaErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = context;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Configuration or environment is missing/invalid — fail fast at startup. */
export class ConfigError extends VtaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONFIG_INVALID', message, context);
  }
}

/** A required secret could not be resolved from the secrets provider. */
export class SecretMissingError extends VtaError {
  constructor(name: string) {
    super('SECRET_MISSING', `Required secret "${name}" was not found`, { name });
  }
}

/** A requested entity does not exist. */
export class NotFoundError extends VtaError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} "${id}" was not found`, { entity, id });
  }
}

/**
 * Cross-tenant access was attempted (e.g. a request scoped to course A tried to
 * read course B). This is a hard isolation guarantee and must never be ignored.
 */
export class TenantMismatchError extends VtaError {
  constructor(expected: string, actual: string) {
    super('TENANT_MISMATCH', 'Cross-course access denied', { expected, actual });
  }
}

/** The agent attempted a tool call the policy engine does not permit. */
export class ToolDeniedError extends VtaError {
  constructor(tool: string, reason: string) {
    super('TOOL_DENIED', `Tool "${tool}" denied: ${reason}`, { tool, reason });
  }
}

/** The primary LLM (and any fallbacks) could not be reached. */
export class LlmUnavailableError extends VtaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('LLM_UNAVAILABLE', message, context);
  }
}

/** Narrow `unknown` caught values to an `Error` for logging. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}
