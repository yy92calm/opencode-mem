/**
 * Simple logging utility
 * 
 * Uses OpenCode SDK client.app.log() to send logs to the logging system
 * instead of console.log which would appear in user's chat.
 */

let opencodeClient: any = null;

export function setLoggerClient(client: any): void {
  opencodeClient = client;
}

async function sendLog(level: 'debug' | 'info' | 'warn' | 'error', service: string, message: string, context?: Record<string, unknown>) {
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
  
  // Fallback to console (only for debug level to avoid cluttering chat)
  if (level === 'debug') {
    console.debug(`[${service}] ${message}`, context);
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
};
