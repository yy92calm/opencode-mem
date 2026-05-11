/**
 * Simple logging utility
 */

export const logger = {
  debug(service: string, message: string, context?: Record<string, unknown>) {
    console.debug(`[${service}] ${message}`, context);
  },

  info(service: string, message: string, context?: Record<string, unknown>) {
    console.log(`[${service}] ${message}`, context);
  },

  warn(service: string, message: string, context?: Record<string, unknown>) {
    console.warn(`[${service}] ${message}`, context);
  },

  error(service: string, message: string, context?: Record<string, unknown>, error?: Error) {
    console.error(`[${service}] ${message}`, context, error);
  },
};
