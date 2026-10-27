/**
 * Every interface and type alias of `@framework/logging`, in one import point.
 * Runtime values (classes, tokens, functions) live in their own modules.
 */

/** Levels accepted by `createLogger`; mirrors loggerkit's `LogLevel`. */
export type LoggingLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Which sink receives the entries: console for dev, file for prod, memory for tests. */
export type LoggingDriverKind = 'console' | 'file' | 'memory';

/** Structured fields attached to a log call. Values must be JSON-safe (Errors go to `error()` directly). */
export type LogFields = Record<string, unknown>;

/**
 * Validated shape of the application's `logging` configuration section,
 * built by `loggingConfigSchema` and consumed by `createFrameworkLogger`.
 */
export interface LoggingConfig {
  /** Entries below this level are dropped. */
  readonly level: LoggingLevel;
  /** Logger name carried on every entry (service name). */
  readonly name: string;
  /** Which sink receives the entries. */
  readonly driver: LoggingDriverKind;
  /** Target file path; required when `driver: 'file'`. */
  readonly filePath?: string;
  /** Rotate the file before the write that would exceed this size in bytes. */
  readonly maxBytes?: number;
}

/**
 * The framework's logger contract (spec §9): structured, redacted entries that
 * always carry the ambient execution context — the correlation id and actor of
 * the current request/job — so logs from one execution are greppable together.
 * Every entry also masks secret-looking fields before any sink sees them.
 */
export interface FrameworkLogger {
  /** The active threshold; entries below it are dropped. */
  readonly level: LoggingLevel;
  /** True when an entry at `level` would be emitted; use to skip costly field building. */
  isLevelEnabled(level: LoggingLevel): boolean;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** Accepts structured fields or an `Error` (serialized on the entry as `error`). */
  error(message: string, fields?: LogFields | Error): void;
  /** Sub-logger with additional bindings; inherits sinks, level, redaction and context enrichment. */
  child(bindings: LogFields): FrameworkLogger;
  /** Waits for all async sink writes currently in flight (file sink). */
  flush(): Promise<void>;
  /** Flushes and closes every sink; idempotent. Called on container shutdown. */
  close(): Promise<void>;
}
