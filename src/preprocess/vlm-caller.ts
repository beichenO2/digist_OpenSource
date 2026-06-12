import axios from 'axios';
import { readFileSync } from 'fs';

const LLM_V1 = `${(process.env.POLARPRIVATE_URL || `http://127.0.0.1:${process.env.POLARPRIVATE_PORT || '12790'}`).replace(/\/$/, '')}/v1`;

const LOCAL_VLM = 'L101' as const;

export interface VLMResult {
  description: string;
  method: typeof LOCAL_VLM | 'fallback';
  duration_ms: number;
  error?: string;
}

function imageToBase64(imagePath: string): string {
  const buf = readFileSync(imagePath);
  return buf.toString('base64');
}

async function tryVision(imagePath: string, prompt: string): Promise<VLMResult> {
  const start = Date.now();
  const b64 = imageToBase64(imagePath);

  const resp = await axios.post(
    `${LLM_V1}/chat/completions`,
    {
      model: LOCAL_VLM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    },
    { timeout: 120_000 },
  );

  const text = resp.data.choices?.[0]?.message?.content || '';
  return {
    description: text,
    method: LOCAL_VLM,
    duration_ms: Date.now() - start,
  };
}

/** Describe an image via PolarPrivate L101 (local VLM slot only). */
export async function describeImage(
  imagePath: string,
  context?: string,
): Promise<VLMResult> {
  const prompt = context
    ? `Describe this image concisely. Context: ${context.slice(0, 200)}`
    : 'Describe this image concisely. What does it show? If it contains text, OCR it.';

  try {
    const result = await tryVision(imagePath, prompt);
    if (result.description.trim()) return result;
  } catch {
    // fall through
  }

  return {
    description: `[Image: ${imagePath.split('/').pop() || 'unknown'}]`,
    method: 'fallback',
    duration_ms: 0,
    error: 'Local VLM unavailable (PolarPrivate L101 / Ollama)',
  };
}

export async function getAvailableVLMs(): Promise<string[]> {
  try {
    const resp = await axios.get(`${LLM_V1}/models`, { timeout: 3000 });
    const models = resp.data?.data || [];
    return models
      .map((m: { id?: string }) => m.id)
      .filter((id: string) => id === 'L101');
  } catch {
    return [];
  }
}
