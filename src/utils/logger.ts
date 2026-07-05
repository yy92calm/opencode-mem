/**
 * Simple logging utility
 * 
 * Uses OpenCode SDK client.app.log() to send logs to the logging system
 * instead of console.log which would appear in user's chat.
 * Falls back to console for ALL levels if the SDK log call fails, so that
 * warn/error messages are never silently dropped.
 */

let opencodeClient: any = null;

export function setLoggerClient(client: any): void {
  opencodeClient = client;
}

async function sendLog(level: 'debug' | 'info' | 'warn' | 'error' | 'fatal', service: string, message: string, context?: Record<string, unknown>) {
  // Use OpenCode SDK log if available
  if (opencodeClient?.app?.log) {
    try {
      await opencodeClient.app.log({
        body: {
          service,
          level,
          message,
          ...context,
        },
      });
      return;
    } catch {
      // Fall back to console if SDK log fails
    }
  }
  
  // Fallback to console for every level — never swallow warn/error.
  const line = `[${service}] ${level.toUpperCase()} ${message}`;
  if (level === 'error' || level === 'fatal') {
    console.error(line, context);
  } else if (level === 'warn') {
    console.warn(line, context);
  } else if (level === 'info') {
    console.info(line, context);
  } else {
    console.debug(line, context);
  }
}

export const logger = {
  debug(service: string, message: string, context?: Record<string, unknown>) {
    sendLog('debug', service, message, context);
  },

  info(service: string, message: string, context?: Record<string, unknown>) {
    sendLog('info', service, message, context);
  },

  warn(service: string, message: string, context?: Record<string, unknown>) {
    sendLog('warn', service, message, context);
  },

  error(service: string, message: string, context?: Record<string, unknown>, error?: Error) {
    sendLog('error', service, message, { ...context, error: error?.message });
  },

  fatal(service: string, message: string, context?: Record<string, unknown>, error?: Error) {
    sendLog('fatal', service, message, { ...context, error: error?.message });
  },
};
