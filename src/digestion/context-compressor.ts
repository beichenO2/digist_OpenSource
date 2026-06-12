import type { ContentItem } from '../types/index.js';
import { generateText, isLlamaServerAvailable } from '../utils/local-llm.js';

export interface CompressedDigest {
  source_id: string;
  source_url: string;
  platform: string;
  title: string;
  key_phrases: string[];
  entities: EntityMention[];
  claims: Claim[];
  summary_sentences: string[];
  compressed_markdown: string;
  compression_ratio: number;
  original_length: number;
}

export interface EntityMention {
  text: string;
  type: 'person' | 'org' | 'tech' | 'product' | 'concept' | 'url' | 'number';
  frequency: number;
}

export interface Claim {
  text: string;
  confidence: number;
  type: 'fact' | 'opinion' | 'prediction' | 'recommendation';
}

export function compressContent(item: ContentItem): CompressedDigest {
  const text = item.body_markdown;
  const sentences = splitSentences(text);

  const keyPhrases = extractKeyPhrases(text);
  const entities = extractEntitiesTyped(text);
  const claims = extractAndClassifyClaims(sentences);
  const summarySentences = extractiveSummary(sentences, Math.max(3, Math.ceil(sentences.length * 0.2)));

  const compressed = buildCompressedMarkdown(item.title, summarySentences, keyPhrases, entities, claims);

  return {
    source_id: item.id,
    source_url: item.source_url,
    platform: item.platform,
    title: item.title,
    key_phrases: keyPhrases,
    entities,
    claims,
    summary_sentences: summarySentences,
    compressed_markdown: compressed,
    compression_ratio: compressed.length / Math.max(text.length, 1),
    original_length: text.length,
  };
}

export function compressBatch(items: ContentItem[]): CompressedDigest[] {
  return items.map(compressContent);
}

/**
 * Hybrid pipeline: heuristic pre-filter → LLM semantic compression.
 * Falls back to heuristic-only compressContent() when LLM is unavailable.
 */
export async function compressWithLLM(item: ContentItem): Promise<CompressedDigest> {
  const heuristic = compressContent(item);

  if (item.body_markdown.length < 200) return heuristic;

  const llmAvailable = await isLlamaServerAvailable();
  if (!llmAvailable) return heuristic;

  try {
    const prefiltered = [
      `Title: ${item.title}`,
      `Platform: ${item.platform}`,
      `Key phrases: ${heuristic.key_phrases.slice(0, 5).join(', ')}`,
      '',
      item.body_markdown.slice(0, 4000),
    ].join('\n');

    const resp = await generateText(prefiltered, {
      system: [
        'You are a knowledge distillation engine. Compress the input into a structured digest.',
        'Output EXACTLY this JSON format (no markdown, no explanation):',
        '{"summary":"2-3 sentence abstractive summary in the same language as input",',
        '"entities":[{"text":"name","type":"person|org|tech|product|concept"}],',
        '"claims":[{"text":"claim text","type":"fact|opinion|prediction","confidence":0.0-1.0}],',
        '"keywords":["keyword1","keyword2"]}',
      ].join('\n'),
      maxTokens: 800,
      temperature: 0.2,
    });

    const parsed = tryParseJSON(resp.text);
    if (!parsed) return heuristic;

    const llmSummary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const llmEntities: EntityMention[] = Array.isArray(parsed.entities)
      ? parsed.entities.map((e: any) => ({
          text: String(e.text || ''),
          type: normalizeEntityType(String(e.type || 'concept')),
          frequency: 1,
        }))
      : heuristic.entities;

    const llmClaims: Claim[] = Array.isArray(parsed.claims)
      ? parsed.claims.map((c: any) => ({
          text: String(c.text || ''),
          type: normalizeClaimType(String(c.type || 'fact')),
          confidence: Number(c.confidence) || 0.5,
        }))
      : heuristic.claims;

    const llmKeywords: string[] = Array.isArray(parsed.keywords)
      ? parsed.keywords.map(String)
      : heuristic.key_phrases;

    const mergedEntities = mergeEntities(heuristic.entities, llmEntities);
    const summaryLines = llmSummary ? [llmSummary] : heuristic.summary_sentences;

    const compressed = buildCompressedMarkdown(
      item.title,
      summaryLines,
      llmKeywords,
      mergedEntities,
      llmClaims,
    );

    return {
      ...heuristic,
      entities: mergedEntities,
      claims: llmClaims,
      key_phrases: llmKeywords,
      summary_sentences: summaryLines,
      compressed_markdown: compressed,
      compression_ratio: compressed.length / Math.max(item.body_markdown.length, 1),
    };
  } catch (err) {
    console.error(`[Compressor] LLM compression failed, using heuristic fallback: ${err}`);
    return heuristic;
  }
}

export async function compressBatchWithLLM(items: ContentItem[]): Promise<CompressedDigest[]> {
  const results: CompressedDigest[] = [];
  for (const item of items) {
    results.push(await compressWithLLM(item));
  }
  return results;
}

function tryParseJSON(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function normalizeEntityType(t: string): EntityMention['type'] {
  const valid: EntityMention['type'][] = ['person', 'org', 'tech', 'product', 'concept', 'url', 'number'];
  const lower = t.toLowerCase();
  return valid.find(v => v === lower) ?? 'concept';
}

function normalizeClaimType(t: string): Claim['type'] {
  const valid: Claim['type'][] = ['fact', 'opinion', 'prediction', 'recommendation'];
  const lower = t.toLowerCase();
  return valid.find(v => v === lower) ?? 'fact';
}

function mergeEntities(heuristic: EntityMention[], llm: EntityMention[]): EntityMention[] {
  const merged = new Map<string, EntityMention>();
  for (const e of heuristic) merged.set(e.text.toLowerCase(), e);
  for (const e of llm) {
    const key = e.text.toLowerCase();
    if (merged.has(key)) {
      merged.get(key)!.frequency += e.frequency;
    } else {
      merged.set(key, e);
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.frequency - a.frequency);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

function extractKeyPhrases(text: string, topN = 10): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'been', 'will', 'would',
    'could', 'should', 'about', 'which', 'their', 'there', 'these',
    'those', 'then', 'than', 'them', 'they', 'what', 'when', 'where',
    'while', 'also', 'just', 'more', 'some', 'very', 'into', 'over',
    'such', 'only', 'other', 'after', 'most', 'like', 'being', 'does',
  ]);

  const freq = new Map<string, number>();
  for (const w of words) {
    if (!stopWords.has(w) && !/^\d+$/.test(w)) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  // Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (!stopWords.has(words[i]) && !stopWords.has(words[i + 1])) {
      freq.set(bigram, (freq.get(bigram) || 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([phrase]) => phrase);
}

function extractEntitiesTyped(text: string): EntityMention[] {
  const entities: EntityMention[] = [];
  const seen = new Map<string, EntityMention>();

  const patterns: Array<[RegExp, EntityMention['type']]> = [
    [/@\w+/g, 'person'],
    [/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, 'person'],
    [/\b(?:Google|Microsoft|Apple|Meta|OpenAI|Anthropic|Amazon|Vercel|GitHub)\b/gi, 'org'],
    [/\b(?:TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+|Ruby|Swift|Kotlin)\b/g, 'tech'],
    [/\b(?:React|Vue|Angular|Node|Next|Nuxt|Django|Flask|Express|FastAPI)\b/g, 'tech'],
    [/\b(?:API|SDK|CLI|MCP|LLM|RAG|NLP|AI|ML|GPU|CPU|SSD|HTTP|REST|GraphQL)\b/g, 'tech'],
    [/\b(?:Docker|Kubernetes|Redis|PostgreSQL|MongoDB|SQLite|MySQL|Kafka)\b/g, 'tech'],
    [/\b(?:GPT|Claude|Gemini|Llama|Mistral|Deepseek)\b/gi, 'product'],
    [/https?:\/\/[^\s)]+/g, 'url'],
    [/\b\d+(?:\.\d+)?(?:\s*(?:%|ms|s|GB|MB|KB|k\+?|M|B|stars?))\b/g, 'number'],
  ];

  for (const [pattern, type] of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[0].toLowerCase();
      if (seen.has(key)) {
        seen.get(key)!.frequency++;
      } else {
        const entity: EntityMention = { text: match[0], type, frequency: 1 };
        seen.set(key, entity);
        entities.push(entity);
      }
    }
  }

  return entities.sort((a, b) => b.frequency - a.frequency);
}

function extractAndClassifyClaims(sentences: string[]): Claim[] {
  return sentences
    .filter(s => s.split(/\s+/).length >= 5 && s.split(/\s+/).length <= 40)
    .map(s => {
      const lower = s.toLowerCase();
      let type: Claim['type'] = 'fact';
      let confidence = 0.5;

      if (/\b(i think|i believe|in my opinion|seems|probably|might|perhaps)\b/i.test(lower)) {
        type = 'opinion';
        confidence = 0.3;
      } else if (/\b(will|going to|expect|predict|forecast|future)\b/i.test(lower)) {
        type = 'prediction';
        confidence = 0.4;
      } else if (/\b(should|recommend|suggest|try|use|consider|better|best)\b/i.test(lower)) {
        type = 'recommendation';
        confidence = 0.6;
      } else if (/\b(is|are|was|has|have|can|does|provides|supports|enables)\b/i.test(lower)) {
        type = 'fact';
        confidence = 0.7;
      }

      // Boost confidence if it contains numbers or specific entities
      if (/\d+/.test(s)) confidence = Math.min(confidence + 0.1, 1);
      if (/\b[A-Z][a-z]+\b/.test(s)) confidence = Math.min(confidence + 0.05, 1);

      return { text: s.trim(), confidence, type };
    })
    .filter(c => c.confidence >= 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20);
}

function extractiveSummary(sentences: string[], topN: number): string[] {
  if (sentences.length <= topN) return sentences;

  const scores = sentences.map((s, i) => {
    let score = 0;
    const words = s.toLowerCase().split(/\s+/);

    // Position bias: first and last sentences are important
    if (i === 0) score += 2;
    if (i === sentences.length - 1) score += 1;
    if (i < 3) score += 1;

    // Length preference: medium-length sentences
    if (words.length >= 8 && words.length <= 30) score += 1;

    // Contains entities
    if (/[A-Z][a-z]+/.test(s)) score += 0.5;
    if (/\d+/.test(s)) score += 0.5;
    if (/https?:\/\//.test(s)) score += 0.3;

    // Contains key verbs
    if (/\b(implement|build|create|support|enable|provide|introduce)\b/i.test(s)) score += 0.5;

    return { sentence: s, score, index: i };
  });

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .sort((a, b) => a.index - b.index) // restore original order
    .map(s => s.sentence);
}

function buildCompressedMarkdown(
  title: string,
  summary: string[],
  keyPhrases: string[],
  entities: EntityMention[],
  claims: Claim[],
): string {
  const parts: string[] = [];

  parts.push(`# ${title}\n`);

  if (summary.length > 0) {
    parts.push('## Summary\n');
    parts.push(summary.join(' ') + '\n');
  }

  if (keyPhrases.length > 0) {
    parts.push('## Key Topics\n');
    parts.push(keyPhrases.map(p => `- ${p}`).join('\n') + '\n');
  }

  const techEntities = entities.filter(e => e.type === 'tech' || e.type === 'product');
  if (techEntities.length > 0) {
    parts.push('## Technologies\n');
    parts.push(techEntities.map(e => `- ${e.text} (${e.frequency}x)`).join('\n') + '\n');
  }

  const factClaims = claims.filter(c => c.type === 'fact' && c.confidence >= 0.6);
  if (factClaims.length > 0) {
    parts.push('## Key Facts\n');
    parts.push(factClaims.slice(0, 5).map(c => `- ${c.text}`).join('\n') + '\n');
  }

  return parts.join('\n');
}
