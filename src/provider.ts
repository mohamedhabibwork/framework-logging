import { ConfigError, defineProvider, type ServiceProvider } from '@framework/core';
import { LOGGER, LOGGING_CONFIG, loggingConfigSchema } from './constants';
import { createFrameworkLogger } from './logger';
import type { LoggingConfig } from './types';

/**
 * Registers the logging stack from configuration (spec §9): the validated
 * `LoggingConfig` under `LOGGING_CONFIG` and the shared `FrameworkLogger`
 * under `LOGGER`. The logger is a process-wide singleton; on container
 * shutdown its sinks are flushed and closed, so file entries never trail.
 *
 * Applications select the `logging` section of their config:
 * `createLoggingProvider((config) => config.logging)`.
 */
export const createLoggingProvider = <TConfig extends object>(
  select: (config: TConfig) => unknown,
): ServiceProvider<TConfig> =>
  defineProvider<TConfig>({
    name: 'logging',
    register({ container, config }) {
      const parsed = loggingConfigSchema.safeParse(select(config));
      if (!parsed.success) {
        throw new ConfigError(parsed.error.issues.map((issue) => `logging.${issue.path.join('.')}: ${issue.message}`));
      }
      const loggingConfig: LoggingConfig = parsed.data;
      container.value(LOGGING_CONFIG, loggingConfig);
      container.singleton(
        LOGGER,
        () => createFrameworkLogger(loggingConfig),
        (logger) => logger.close(),
      );
    },
  });
