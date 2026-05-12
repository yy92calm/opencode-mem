/**
 * OpenCode SDK Client
 * 
 * Manages connection to OpenCode server and handles AI observation generation
 * via the session.prompt() API with structured JSON output.
 */

import { logger } from '../utils/logger.js';
import {
  buildObservationPrompt,
  buildSessionSummaryPrompt,
  parseObservationResponse,
  parseSessionSummaryResponse,
  observationJsonSchema,
  sessionSummaryJsonSchema,
  type ObservationSchema,
  type SessionSummarySchema,
} from './observer.js';

let opencodeClient: any = null;
let observerSessionId: string | null = null;
let observerMessageCount: number = 0;

const MAX_OBSERVER_MESSAGES = 100; // Clean up after 100 messages to balance efficiency

/**
 * Initialize OpenCode SDK client
 * Can be called from plugin context or standalone
 */
export async function initializeOpencodeClient(): Promise<any> {
  if (opencodeClient) {
    return opencodeClient;
  }

  try {
    // Try to import and create client
    // In plugin context, the client is passed via plugin context
    // For standalone usage, would use createOpencodeClient from SDK
    logger.info('SDK_CLIENT', 'OpenCode SDK client initialized');
    return null; // Will be injected via plugin context
  } catch (error) {
    logger.warn('SDK_CLIENT', `Failed to initialize OpenCode client: ${error}`);
    return null;
  }
}

/**
 * Find existing observer session and reuse it
 * Clean up duplicate observer sessions if found
 */
async function findExistingObserverSession(client: any, workdir?: string): Promise<string | null> {
  try {
    const result = await client.session.list({
      query: { directory: workdir },
    });

    const sessions = result?.data || [];
    
    // Find all observer sessions by title
    const observerSessions = sessions.filter(
      (s: any) => s.title === 'mem-observer'
    );

    if (observerSessions.length === 0) {
      return null;
    }

    // Reuse the first one, delete the rest
    const reuseSession = observerSessions[0];
    logger.info('SDK_CLIENT', `Reusing existing observer session: ${reuseSession.id}`);

    // Delete duplicate sessions
    for (let i = 1; i < observerSessions.length; i++) {
      try {
        await client.session.delete({
          path: { id: observerSessions[i].id },
        });
        logger.info('SDK_CLIENT', `Deleted duplicate observer session: ${observerSessions[i].id}`);
      } catch (e) {
        logger.warn('SDK_CLIENT', `Failed to delete duplicate session: ${e}`);
      }
    }

    return reuseSession.id;
  } catch (error) {
    logger.warn('SDK_CLIENT', `Failed to list sessions: ${error}`);
    return null;
  }
}

/**
 * Get or create an observer session for background analysis
 * This session is separate from user sessions to avoid queueing
 * 
 * Cleanup strategy: reuse existing, delete duplicates, recreate after 100 messages
 */
async function getOrCreateObserverSession(workdir?: string): Promise<string | null> {
  const client = getOpencodeClient();
  if (!client) return null;

  // Check if we need to clean up (too many messages accumulated)
  if (observerSessionId && observerMessageCount >= MAX_OBSERVER_MESSAGES) {
    logger.info('SDK_CLIENT', `Cleaning up observer session (messages: ${observerMessageCount})`);
    await cleanupObserverSession();
  }

  // If we already have a session ID in memory, reuse it
  if (observerSessionId) {
    return observerSessionId;
  }

  // Try to find and reuse existing observer session
  const existingId = await findExistingObserverSession(client, workdir);
  if (existingId) {
    observerSessionId = existingId;
    observerMessageCount = 0;
    return observerSessionId;
  }

  // Create new observer session if none exists
  try {
    const result = await client.session.create({
      body: {
        title: 'mem-observer',
      },
      query: {
        directory: workdir,
      },
    });

    if (result?.data?.id) {
      observerSessionId = result.data.id;
      observerMessageCount = 0;
      logger.info('SDK_CLIENT', `Created new observer session: ${observerSessionId}`);
      return observerSessionId;
    }
  } catch (error) {
    logger.warn('SDK_CLIENT', `Failed to create observer session: ${error}`);
  }

  return null;
}

/**
 * Clean up observer session when plugin shuts down
 */
export async function cleanupObserverSession(): Promise<void> {
  const client = getOpencodeClient();
  if (!client || !observerSessionId) return;

  try {
    await client.session.delete({
      path: { id: observerSessionId },
    });
    logger.info('SDK_CLIENT', `Deleted observer session: ${observerSessionId}`);
    observerSessionId = null;
  } catch (error) {
    logger.warn('SDK_CLIENT', `Failed to delete observer session: ${error}`);
  }
}

/**
 * Set the OpenCode client (called from plugin context)
 */
export function setOpencodeClient(client: any): void {
  opencodeClient = client;
  logger.debug('SDK_CLIENT', 'OpenCode client set from plugin context');
}

/**
 * Get current OpenCode client
 */
export function getOpencodeClient(): any {
  return opencodeClient;
}

/**
 * Generate observation using OpenCode session.prompt() with structured output
 * 
 * This leverages the configured AI model (Claude, OpenRouter, etc.)
 * without requiring separate API keys.
 */
export async function generateObservationViaSDK(
  sessionId: string,
  toolExecution: {
    tool: string;
    input: unknown;
    output: string;
    workdir?: string;
  }
): Promise<ObservationSchema | null> {
  const client = getOpencodeClient();
  if (!client) {
    logger.warn('SDK_CLIENT', 'OpenCode client not available for observation generation');
    return null;
  }

  try {
    logger.debug('SDK_CLIENT', `Generating observation for ${toolExecution.tool}`, {
      toolName: toolExecution.tool,
    });

    // Get or create observer session (separate from user session)
    const observerId = await getOrCreateObserverSession(toolExecution.workdir);
    if (!observerId) {
      logger.warn('SDK_CLIENT', 'Could not create observer session, falling back to rule-based');
      return null;
    }

    const prompt = buildObservationPrompt(toolExecution);

    // Use promptAsync to avoid blocking user's session
    const result = await client.session.promptAsync({
      path: { id: observerId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        outputFormat: {
          type: 'json_schema',
          schema: observationJsonSchema,
          retryCount: 2,
        },
        noReply: false,
      },
      query: {
        directory: toolExecution.workdir,
      },
    });

    // promptAsync returns 204, so we need to wait and poll for result
    // For now, fall back to synchronous prompt with observer session
    // TODO: Implement polling mechanism for async results
    const syncResult = await client.session.prompt({
      path: { id: observerId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        outputFormat: {
          type: 'json_schema',
          schema: observationJsonSchema,
          retryCount: 2,
        },
        noReply: false,
      },
      query: {
        directory: toolExecution.workdir,
      },
    });

    // Increment message counter after successful prompt
    observerMessageCount++;

    // Extract structured output from response
    const structuredOutput = syncResult?.data?.info?.structured_output;
    if (!structuredOutput) {
      logger.warn('SDK_CLIENT', 'No structured output in AI response');
      return null;
    }

    const parsed = parseObservationResponse(structuredOutput);
    if (!parsed) {
      logger.warn('SDK_CLIENT', 'Failed to parse observation response');
      return null;
    }

    logger.info('SDK_CLIENT', `Generated observation: ${parsed.title}`, {
      toolName: toolExecution.tool,
      type: parsed.type,
    });

    return parsed;
  } catch (error) {
    logger.warn('SDK_CLIENT', `Failed to generate observation via SDK: ${error}`, {
      toolName: toolExecution.tool,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Generate session summary using OpenCode session.prompt()
 */
export async function generateSessionSummaryViaSDK(
  sessionId: string,
  sessionInfo: {
    userRequest: string;
    toolsUsed: string[];
    filesRead: string[];
    filesModified: string[];
    recentObservations: string[];
  }
): Promise<SessionSummarySchema | null> {
  const client = getOpencodeClient();
  if (!client) {
    logger.warn('SDK_CLIENT', 'OpenCode client not available for summary generation');
    return null;
  }

  try {
    logger.debug('SDK_CLIENT', 'Generating session summary');

    // Get or create observer session (separate from user session)
    const observerId = await getOrCreateObserverSession();
    if (!observerId) {
      logger.warn('SDK_CLIENT', 'Could not create observer session');
      return null;
    }

    const prompt = buildSessionSummaryPrompt(sessionInfo);

    const result = await client.session.prompt({
      path: { id: observerId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        outputFormat: {
          type: 'json_schema',
          schema: sessionSummaryJsonSchema,
          retryCount: 2,
        },
        noReply: false,
      },
    });

    // Increment message counter after successful prompt
    observerMessageCount++;

    const structuredOutput = result?.data?.info?.structured_output;
    if (!structuredOutput) {
      logger.warn('SDK_CLIENT', 'No structured output in summary response');
      return null;
    }

    const parsed = parseSessionSummaryResponse(structuredOutput);
    if (!parsed) {
      logger.warn('SDK_CLIENT', 'Failed to parse summary response');
      return null;
    }

    logger.info('SDK_CLIENT', 'Generated session summary');
    return parsed;
  } catch (error) {
    logger.warn('SDK_CLIENT', `Failed to generate summary via SDK: ${error}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check if OpenCode client is available
 */
export function isSDKAvailable(): boolean {
  return !!getOpencodeClient();
}
