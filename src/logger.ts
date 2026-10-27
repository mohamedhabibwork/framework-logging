import { ConfigError, currentExecution } from '@framework/core';
import type { Logger as LoggerKitLogger, LogLevel } from '@mohamedhabibwork/loggerkit';
import { createLogger, type SinkSpec } from '@mohamedhabibwork/loggerkit/factory';
import { redactLogFields } from './redact';
import type { FrameworkLogger, LogFields, LoggingConfig, LoggingLevel } from './types';

/**
 * Ambient fields attached to every entry: the correlation id and actor of the
 * current request/job (spec §9 correlation across requests/jobs). Read from
 * the runtime's `AsyncLocalStorage`; falls back to the standalone execution
 * (`correlationId: 'standalone'`, anonymous actor) outside one — scripts,
 * tests and boot-time logging still get consistent, greppable lines.
 */
export function executionContextFields(): LogFields {
  const execution = currentExecution();
  return {
    correlationId: execution.correlationId,
    actorId: execution.actor.id ?? null,
    actorType: execution.actor.type,
  };
}

/**
 * Builds the application logger over loggerkit (spec §9 structured redacted
 * logs). The `FrameworkLogger` view adds the two framework semantics on top of
 * loggerkit's sinks/levels/formatting: context enrichment and field redaction.
 */
export function createFrameworkLogger(config: LoggingConfig): FrameworkLogger {
  if (config.driver === 'file' && config.filePath === undefined) {
    throw new ConfigError(['logging.filePath: driver "file" requires filePath']);
  }
  const sink: SinkSpec =
    config.driver === 'file'
      ? {
          kind: 'file',
          filePath: config.filePath,
          ...(config.maxBytes === undefined ? {} : { maxBytes: config.maxBytes }),
        }
      : { kind: config.driver };
  const inner = createLogger({ name: config.name, level: config.level, sinks: [sink] });
  return new FrameworkLoggerView(inner);
}

/**
 * Adapts any loggerkit `Logger` (or one created by `createLogger` with custom
 * options) into the framework's logger view, so applications that build their
 * own instances keep the context enrichment and redaction semantics.
 */
export function bindLogger(inner: LoggerKitLogger): FrameworkLogger {
  return new FrameworkLoggerView(inner);
}

/**
 * Typed `FrameworkLogger` implementation wrapping a loggerkit `Logger`.
 * Enrichment and redaction are applied at the call site (before the inner
 * logger's processor chain and sinks), which is the only injection point that
 * also works for loggers this package did not create.
 */
class FrameworkLoggerView implements FrameworkLogger {
  constructor(private readonly inner: LoggerKitLogger) {}

  get level(): LoggingLevel {
    return this.inner.level;
  }

  isLevelEnabled(level: LoggingLevel): boolean {
    return this.inner.isLevelEnabled(level);
  }

  debug(message: string, fields?: LogFields): void {
    this.#write('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.#write('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.#write('warn', message, fields);
  }

  error(message: string, fields?: LogFields | Error): void {
    if (!this.inner.isLevelEnabled('error')) return;
    if (fields instanceof Error) {
      // loggerkit extracts `context.error` into the entry's serialized `error`;
      // the ambient merge keeps the correlation id on the same line.
      this.inner.error(message, { ...executionContextFields(), error: fields });
      return;
    }
    this.inner.error(message, this.#merged(fields));
  }

  child(bindings: LogFields): FrameworkLoggerView {
    return new FrameworkLoggerView(this.inner.child('', { ...bindings }));
  }

  flush(): Promise<void> {
    return this.inner.flush();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  #write(level: LogLevel, message: string, fields?: LogFields): void {
    if (!this.inner.isLevelEnabled(level)) return;
    this.inner[level](message, this.#merged(fields));
  }

  /** Ambient context under the (redacted) call-site fields; callers may override ambient keys. */
  #merged(fields?: LogFields): LogFields {
    const ambient = executionContextFields();
    if (fields === undefined) return ambient;
    return { ...ambient, ...redactLogFields(fields) };
  }
}
