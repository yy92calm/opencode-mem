import type { LLMConfig } from '../types/index.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

/**
 * OpenAI-compatible LLM client.
 * Works with OpenAI, Ollama (with /v1 endpoint), OpenRouter, Together, vLLM, etc.
 */
export class LLMClient {
  constructor(private cfg: LLMConfig) {}

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const url = `${this.cfg.base_url.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: this.cfg.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens,
      ...(opts.response_format && { response_format: opts.response_format }),
    };

    let lastError: unknown = null;
    for (let attempt = 0; attempt < this.cfg.max_retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.timeout_ms);
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.cfg.api_key}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`LLM ${resp.status}: ${text.slice(0, 500)}`);
        }

        const data = await resp.json() as any;
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error(`LLM returned malformed response: ${JSON.stringify(data).slice(0, 300)}`);
        }
        return content;
      } catch (e) {
        lastError = e;
        if (attempt < this.cfg.max_retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw new Error(`LLM call failed after ${this.cfg.max_retries} attempts: ${lastError}`);
  }
}

let _client: LLMClient | null = null;

export function initLLM(cfg: LLMConfig): LLMClient {
  _client = new LLMClient(cfg);
  return _client;
}

export function getLLM(): LLMClient {
  if (!_client) throw new Error('LLM client not initialized');
  return _client;
}
