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

    const prompt = buildObservationPrompt(toolExecution);

    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        outputFormat: {
          type: 'json_schema',
          schema: observationJsonSchema,
          retryCount: 2,
        },
        noReply: false,
      },
    });

    // Extract structured output from response
    const structuredOutput = result?.data?.info?.structured_output;
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

    const prompt = buildSessionSummaryPrompt(sessionInfo);

    const result = await client.session.prompt({
      path: { id: sessionId },
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
