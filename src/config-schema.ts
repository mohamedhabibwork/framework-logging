import { z } from 'zod/v4';
import type { LoggingConfig } from './types';

/**
 * Validated shape of the application's `logging` configuration section. Apps
 * compose it into their config schema: `logging: loggingConfigSchema.default({})`.
 */
export const loggingConfigSchema = z
  .object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    name: z.string().min(1).default('app'),
    driver: z.enum(['console', 'file', 'memory']).default('console'),
    filePath: z.string().min(1).optional(),
    maxBytes: z.number().int().positive().optional(),
  })
  .refine((config) => config.driver !== 'file' || config.filePath !== undefined, {
    message: 'driver "file" requires filePath',
    path: ['filePath'],
  });

/** Resolved defaults, exported for tests and documentation. */
export const defaultLoggingConfig: LoggingConfig = loggingConfigSchema.parse({});
