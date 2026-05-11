/**
 * AI Observer Service
 * 
 * Integrates with Anthropic Claude API to generate intelligent observations
 * from tool executions. Uses the claude-mem pattern of AI-driven insight extraction.
 */

import { logger } from '../utils/logger.js';
import {
  buildObservationPrompt,
  buildSessionSummaryPrompt,
  parseObservationResponse,
  parseSummaryResponse,
  type ToolExecution,
  type ParsedObservation,
  type ParsedSummary,
} from './prompts.js';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Initialize Anthropic client
 * Supports API key from environment or custom config
 */
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not set. Set it in your environment to enable AI observation generation.'
    );
  }

  // Return fetch-based client (works in both Node.js and browser-like environments)
  return {
    apiKey,
    model: 'claude-3-5-sonnet-20241022', // Latest Claude 3.5 Sonnet
    async message(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ClaudeMessage[];
    }): Promise<{ content: Array<{ type: string; text: string }> }> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${error}`);
      }

      return response.json();
    },
  };
}

/**
 * Generate observation from tool execution using AI
 * Falls back to rule-based generation if AI fails
 */
export async function generateAIObservation(
  toolExecution: ToolExecution,
  fallbackGenerator?: () => Omit<ParsedObservation, 'skip'>
): Promise<ParsedObservation | null> {
  try {
    const client = getAnthropicClient();
    const prompt = buildObservationPrompt(toolExecution);

    logger.debug('AI_OBSERVER', `Generating observation for ${toolExecution.tool}`, {
      toolName: toolExecution.tool,
    });

    const response = await client.message({
      model: client.model,
      max_tokens: 1000,
      system: 'You are an expert software engineer analyzing development session activities.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      logger.warn('AI_OBSERVER', 'No text content in AI response');
      return fallbackGenerator?.() || null;
    }

    const parsed = parseObservationResponse(textContent.text);
    if (!parsed) {
      logger.warn('AI_OBSERVER', 'Failed to parse AI observation response');
      return fallbackGenerator?.() || null;
    }

    if (parsed.skip) {
      logger.debug('AI_OBSERVER', 'AI skipped trivial observation');
      return null;
    }

    logger.info('AI_OBSERVER', `Generated observation: ${parsed.title}`, {
      toolName: toolExecution.tool,
      type: parsed.type,
    });

    return parsed;
  } catch (error) {
    logger.warn('AI_OBSERVER', `Failed to generate AI observation: ${error}`, {
      toolName: toolExecution.tool,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fall back to rule-based generation if provided
    if (fallbackGenerator) {
      logger.debug('AI_OBSERVER', 'Using fallback observation generator');
      return fallbackGenerator();
    }

    return null;
  }
}

/**
 * Generate session summary using AI
 */
export async function generateAISummary(sessionInfo: {
  userRequest: string;
  toolsUsed: string[];
  filesRead: string[];
  filesModified: string[];
  observations: string[];
}): Promise<ParsedSummary | null> {
  try {
    const client = getAnthropicClient();
    const prompt = buildSessionSummaryPrompt(sessionInfo);

    logger.debug('AI_OBSERVER', 'Generating session summary');

    const response = await client.message({
      model: client.model,
      max_tokens: 1500,
      system: 'You are an expert at creating concise progress summaries for development sessions.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      logger.warn('AI_OBSERVER', 'No text content in summary response');
      return null;
    }

    const parsed = parseSummaryResponse(textContent.text);
    if (!parsed) {
      logger.warn('AI_OBSERVER', 'Failed to parse AI summary response');
      return null;
    }

    logger.info('AI_OBSERVER', 'Generated session summary');
    return parsed;
  } catch (error) {
    logger.warn('AI_OBSERVER', `Failed to generate AI summary: ${error}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check if AI observation generation is available
 */
export function isAIObservationAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
