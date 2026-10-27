import { redact } from '@framework/core';

/**
 * Log-payload redaction following the framework's conventions — the exact
 * `redact` from `@framework/core/config/redact` (secret-looking keys such as
 * password/token/authorization masked, credentials inside URLs masked). This
 * mirrors `@framework/support`'s `redactForLogs`, reimplemented here only
 * because this package must not depend on `@framework/support`.
 *
 * `Error` instances pass through untouched: loggerkit promotes
 * `context.error` to the entry's `error` field and serializes it itself
 * (name/message/cause); running a live `Error` through the deep copier would
 * strip its prototype and lose the stack.
 */
export function redactLogFields<T>(value: T, key = ''): T {
  if (value instanceof Error) return value;
  return redact(value, key);
}
