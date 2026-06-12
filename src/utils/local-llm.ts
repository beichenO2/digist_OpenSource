/**
 * LLM utilities via PolarPrivate cloud capability codes.
 * Uses 4-bit QCSA codes (default 0001 = agent fast).
 */

import axios from 'axios';

const LLM_PROXY_V1 =
  process.env.POLARPRIVATE_URL?.replace(/\/$/, '') ||
  `http://127.0.0.1:${process.env.POLARPRIVATE_PORT ?? '8005'}`;
const LLM_V1 = `${LLM_PROXY_V1}/v1`;

function resolveModel(capability?: string): string {
  const c = (capability ?? '0001').trim();
  if (c.toUpperCase().startsWith('V') && c.length === 5) return c.toUpperCase();
  if (/^[01]{4}$/.test(c)) return c;
  if (c.includes('-') || c.length > 4) return c;
  return '0001';
}

export interface LLMResponse {
  text: string;
  model: string;
  duration_ms: number;
}

export async function generateText(
  prompt: string,
  options: {
    capability?: string;
    maxTokens?: number;
    temperature?: number;
    system?: string;
  } = {},
): Promise<LLMResponse> {
  const modelId = resolveModel(options.capability);
  const start = Date.now();

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: prompt });

  const resp = await axios.post(
    `${LLM_V1}/chat/completions`,
    {
      model: modelId,
      messages,
      max_tokens: options.maxTokens || 500,
      temperature: options.temperature ?? 0.7,
    },
    { timeout: 120_000 },
  );

  const text = resp.data.choices?.[0]?.message?.content || '';
  return { text, model: resp.data.model ?? modelId, duration_ms: Date.now() - start };
}

export async function summarize(text: string, maxLength = 200): Promise<string> {
  const resp = await generateText(text, {
    capability: '0011',
    system: `You are a concise summarizer. Summarize the following text in ${maxLength} characters or less. Use the same language as the input.`,
    maxTokens: 200,
    temperature: 0.3,
  });
  return resp.text.trim();
}

export async function classify(text: string, categories: string[]): Promise<string> {
  const resp = await generateText(
    `Text: "${text.slice(0, 500)}"\n\nClassify into exactly one category from: ${categories.join(', ')}\n\nRespond with only the category name.`,
    { capability: '0011', maxTokens: 20, temperature: 0.1 },
  );
  const result = resp.text.trim().toLowerCase();
  return categories.find(c => result.includes(c.toLowerCase())) ?? categories[0] ?? 'unknown';
}

export async function extractKeywords(text: string, count = 5): Promise<string[]> {
  const resp = await generateText(
    `Extract ${count} key topics from this text. Return only comma-separated keywords.\n\nText: "${text.slice(0, 1000)}"`,
    { capability: '0011', maxTokens: 100, temperature: 0.2 },
  );
  return resp.text.split(',').map(k => k.trim()).filter(Boolean).slice(0, count);
}

let _llmAvailableCache: { result: boolean; ts: number } | null = null;
const LLM_AVAIL_CACHE_TTL = 120_000;

export async function isLlamaServerAvailable(): Promise<boolean> {
  if (_llmAvailableCache && Date.now() - _llmAvailableCache.ts < LLM_AVAIL_CACHE_TTL) {
    return _llmAvailableCache.result;
  }
  try {
    const resp = await axios.get(
      `${LLM_PROXY_V1}/health`,
      { timeout: 5000 },
    );
    const ok = resp.status === 200;
    _llmAvailableCache = { result: ok, ts: Date.now() };
    if (!ok) console.warn('[LLM] health check failed: status', resp.status);
    return ok;
  } catch (err: any) {
    // Fallback: try actual completions endpoint
    try {
      const resp2 = await axios.post(
        `${LLM_V1}/chat/completions`,
        { model: '1001', messages: [{ role: 'user', content: '1' }], max_tokens: 5 },
        { timeout: 30000 },
      );
      _llmAvailableCache = { result: resp2.status === 200, ts: Date.now() };
      return _llmAvailableCache.result;
    } catch {
      console.warn('[LLM] health check failed:', err?.message);
      _llmAvailableCache = { result: false, ts: Date.now() };
      return false;
    }
  }
}

export const isLocalLlmAvailable = isLlamaServerAvailable;
