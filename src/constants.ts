/** Constants of `@framework/logging`: container tokens and fixed defaults. */

import { token } from '@framework/core';
import type { FrameworkLogger, LoggingConfig } from './types';

export { defaultLoggingConfig, loggingConfigSchema } from './config-schema';

/** The application's configured logger (structured, redacted, context-enriched). */
export const LOGGER = token<FrameworkLogger>('logging.logger');
/** The validated logging configuration the logger was built from. */
export const LOGGING_CONFIG = token<LoggingConfig>('logging.config');
