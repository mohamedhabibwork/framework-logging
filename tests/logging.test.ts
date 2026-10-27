import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, Container, ExecutionContext, REDACTED, runWithExecution } from '@framework/core';
import { createLogger } from '@mohamedhabibwork/loggerkit/factory';
import { createCapture } from '@mohamedhabibwork/loggerkit/testing';
import {
  bindLogger,
  createFrameworkLogger,
  createLoggingProvider,
  defaultLoggingConfig,
  LOGGER,
  LOGGING_CONFIG,
} from '../src';

const actor = { id: 'user-1', type: 'user' } as const;

/** A request-scoped execution with a stable correlation id. */
const request = () => new ExecutionContext('request', 'corr-logging', actor);

/** A loggerkit logger wired to an inspectable memory capture, behind the framework view. */
const captureLogger = () => {
  const capture = createCapture();
  return { capture, logger: bindLogger(createLogger({ name: 'test', sinks: [capture.sink] })) };
};

describe('execution-context enrichment', () => {
  test('entries carry the ambient correlation id and actor inside an execution', () => {
    const { capture, logger } = captureLogger();
    runWithExecution(request(), () => {
      logger.info('hello', { userId: 'u-9' });
    });
    const entry = capture.entries[0];
    expect(entry?.message).toBe('hello');
    expect(entry?.context.correlationId).toBe('corr-logging');
    expect(entry?.context.actorId).toBe('user-1');
    expect(entry?.context.actorType).toBe('user');
    expect(entry?.context.userId).toBe('u-9');
  });

  test('logging outside an execution falls back to the standalone context', () => {
    const { capture, logger } = captureLogger();
    logger.warn('boot time');
    const entry = capture.entries[0];
    expect(entry?.context.correlationId).toBe('standalone');
    expect(entry?.context.actorId).toBeNull();
    expect(entry?.context.actorType).toBe('anonymous');
  });
});

describe('redaction', () => {
  test('secret-looking keys and URL credentials are masked before the sink sees them', () => {
    const { capture, logger } = captureLogger();
    logger.info('signup', {
      password: 'hunter2',
      authorization: 'Bearer t0k3n',
      nested: { api_key: 'k-123' },
      dbUrl: 'postgres://user:p4ss@host/db?password=plain',
      keep: 'visible',
    });
    const context = capture.entries[0]?.context as Record<string, unknown>;
    expect(context.password).toBe(REDACTED);
    expect(context.authorization).toBe(REDACTED);
    expect((context.nested as Record<string, unknown>).api_key).toBe(REDACTED);
    expect(context.dbUrl).toBe('postgres://user:[REDACTED]@host/db?password=[REDACTED]');
    expect(context.keep).toBe('visible');
  });

  test('error() keeps the correlation id and a live Error on the entry', () => {
    const { capture, logger } = captureLogger();
    runWithExecution(request(), () => {
      logger.error('boom', new Error('kaboom'));
    });
    const entry = capture.entries[0];
    expect(entry?.context.correlationId).toBe('corr-logging');
    expect(entry?.error).toBeInstanceOf(Error);
    expect(entry?.error?.message).toBe('kaboom');
  });
});

describe('levels', () => {
  test('entries below the threshold are suppressed', () => {
    const capture = createCapture();
    const logger = bindLogger(createLogger({ level: 'warn', sinks: [capture.sink] }));
    logger.debug('nope');
    logger.info('nope');
    logger.warn('yes');
    logger.error('yes');
    expect(capture.messages()).toEqual(['yes', 'yes']);
    expect(logger.level).toBe('warn');
    expect(logger.isLevelEnabled('info')).toBe(false);
    expect(logger.isLevelEnabled('error')).toBe(true);
  });
});

describe('sinks', () => {
  test('the file sink receives NDJSON lines with the framework fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'framework-logging-'));
    const filePath = join(dir, 'app.log');
    try {
      const logger = createFrameworkLogger({
        level: 'debug',
        name: 'fw-test',
        driver: 'file',
        filePath,
        maxBytes: 10_000,
      });
      runWithExecution(new ExecutionContext('job', 'job-7', actor), () => {
        logger.info('job done', { attempts: 2, password: 's3cret' });
      });
      await logger.flush();
      const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
      expect(parsed.name).toBe('fw-test');
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('job done');
      expect(parsed.correlationId).toBe('job-7');
      expect(parsed.actorId).toBe('user-1');
      expect(parsed.actorType).toBe('user');
      expect(parsed.attempts).toBe(2);
      expect(parsed.password).toBe(REDACTED);
      await logger.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the memory driver builds a working logger without a file', () => {
    const logger = createFrameworkLogger({ level: 'info', name: 'mem', driver: 'memory' });
    expect(logger.level).toBe('info');
    expect(logger.isLevelEnabled('trace')).toBe(false);
    expect(logger.isLevelEnabled('info')).toBe(true);
  });
});

describe('child()', () => {
  test('inherits enrichment and redaction, and keeps bindings isolated', () => {
    const { capture, logger } = captureLogger();
    const child = logger.child({ module: 'db' });
    runWithExecution(request(), () => {
      child.info('query', { ms: 5, token: 'abc' });
    });
    const childEntry = capture.entries[0];
    expect(childEntry?.context.module).toBe('db');
    expect(childEntry?.context.correlationId).toBe('corr-logging');
    expect(childEntry?.context.token).toBe(REDACTED);
    logger.info('parent line');
    const parentEntry = capture.entries[1];
    expect(parentEntry?.context).not.toHaveProperty('module');
    // The parent call runs outside the execution, so it enriches independently.
    expect(parentEntry?.context.correlationId).toBe('standalone');
  });
});

describe('createLoggingProvider', () => {
  test('registers the validated config and a logger honoring it', () => {
    const container = new Container();
    const provider = createLoggingProvider<{ logging?: Record<string, unknown> }>((config) => config.logging);
    provider.register({ container, config: { logging: { driver: 'memory', level: 'warn' } } });
    const config = container.resolve(LOGGING_CONFIG);
    expect(config.level).toBe('warn');
    expect(config.driver).toBe('memory');
    expect(config.name).toBe('app');
    const logger = container.resolve(LOGGER);
    expect(logger.level).toBe('warn');
    expect(logger.isLevelEnabled('info')).toBe(false);
  });

  test('applies schema defaults to an empty section', () => {
    const container = new Container();
    const provider = createLoggingProvider<{ logging?: Record<string, unknown> }>((config) => config.logging);
    provider.register({ container, config: { logging: {} } });
    expect(container.resolve(LOGGING_CONFIG)).toEqual(defaultLoggingConfig);
  });

  test('rejects a file driver without filePath with a ConfigError', () => {
    const container = new Container();
    const provider = createLoggingProvider<{ logging?: Record<string, unknown> }>((config) => config.logging);
    expect(() => provider.register({ container, config: { logging: { driver: 'file' } } })).toThrow(ConfigError);
  });
});
