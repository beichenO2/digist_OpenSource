/**
 * @deprecated Use `src/wiki/wiki-search.ts` instead.
 * This TF-IDF index is replaced by the Agentic Wiki approach (Karpathy 2026):
 * knowledge is compiled into persistent markdown wiki pages and loaded
 * directly into the LLM context window, rather than retrieved via vectors.
 *
 * Kept for backward compatibility with existing tests.
 */
import type { ContentItem } from '../types/index.js';
import { compressContent, type CompressedDigest } from './context-compressor.js';

export interface KnowledgeFragment {
  id: string;
  source_id: string;
  source_url: string;
  platform: string;
  fragment_type: 'claim' | 'entity' | 'key_phrase' | 'summary';
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SearchResult {
  fragment: KnowledgeFragment;
  score: number;
}

export class KnowledgeIndex {
  private fragments: KnowledgeFragment[] = [];
  private idfCache = new Map<string, number>();
  private corpusSize = 0;

  ingestItem(item: ContentItem): KnowledgeFragment[] {
    const digest = compressContent(item);
    const newFragments = this.digestToFragments(item, digest);

    this.fragments.push(...newFragments);
    this.corpusSize++;
    this.idfCache.clear(); // invalidate cache

    return newFragments;
  }

  ingestBatch(items: ContentItem[]): number {
    let count = 0;
    for (const item of items) {
      count += this.ingestItem(item).length;
    }
    return count;
  }

  search(query: string, topK = 10): SearchResult[] {
    const queryVec = this.textToVector(query);

    const scored = this.fragments.map(fragment => ({
      fragment,
      score: cosineSimilarity(queryVec, fragment.vector),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(r => r.score > 0);
  }

  semanticSearch(query: string, filters?: { platform?: string; type?: string }, topK = 10): SearchResult[] {
    let candidates = this.fragments;

    if (filters?.platform) {
      candidates = candidates.filter(f => f.platform === filters.platform);
    }
    if (filters?.type) {
      candidates = candidates.filter(f => f.fragment_type === filters.type);
    }

    const queryVec = this.textToVector(query);

    return candidates
      .map(fragment => ({
        fragment,
        score: cosineSimilarity(queryVec, fragment.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(r => r.score > 0);
  }

  findRelated(fragmentId: string, topK = 5): SearchResult[] {
    const target = this.fragments.find(f => f.id === fragmentId);
    if (!target) return [];

    return this.fragments
      .filter(f => f.id !== fragmentId)
      .map(fragment => ({
        fragment,
        score: cosineSimilarity(target.vector, fragment.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  getStats(): {
    total_fragments: number;
    by_type: Record<string, number>;
    by_platform: Record<string, number>;
    vocabulary_size: number;
  } {
    const byType: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};

    for (const f of this.fragments) {
      byType[f.fragment_type] = (byType[f.fragment_type] || 0) + 1;
      byPlatform[f.platform] = (byPlatform[f.platform] || 0) + 1;
    }

    return {
      total_fragments: this.fragments.length,
      by_type: byType,
      by_platform: byPlatform,
      vocabulary_size: this.buildVocabulary().size,
    };
  }

  private digestToFragments(item: ContentItem, digest: CompressedDigest): KnowledgeFragment[] {
    const fragments: KnowledgeFragment[] = [];
    const now = new Date().toISOString();

    // Summary fragment
    if (digest.summary_sentences.length > 0) {
      const summaryText = digest.summary_sentences.join(' ');
      fragments.push({
        id: `${item.id}-summary`,
        source_id: item.id,
        source_url: item.source_url,
        platform: item.platform,
        fragment_type: 'summary',
        text: summaryText,
        vector: this.textToVector(summaryText),
        metadata: { compression_ratio: digest.compression_ratio },
        created_at: now,
      });
    }

    // Claim fragments
    for (let i = 0; i < digest.claims.length; i++) {
      const claim = digest.claims[i];
      fragments.push({
        id: `${item.id}-claim-${i}`,
        source_id: item.id,
        source_url: item.source_url,
        platform: item.platform,
        fragment_type: 'claim',
        text: claim.text,
        vector: this.textToVector(claim.text),
        metadata: { confidence: claim.confidence, claim_type: claim.type },
        created_at: now,
      });
    }

    // Entity fragments (grouped)
    const entities = digest.entities.filter(e => e.frequency >= 2 || e.type === 'tech');
    if (entities.length > 0) {
      const entityText = entities.map(e => `${e.text} (${e.type})`).join(', ');
      fragments.push({
        id: `${item.id}-entities`,
        source_id: item.id,
        source_url: item.source_url,
        platform: item.platform,
        fragment_type: 'entity',
        text: entityText,
        vector: this.textToVector(entityText),
        metadata: { entity_count: entities.length },
        created_at: now,
      });
    }

    // Key phrase fragments
    if (digest.key_phrases.length > 0) {
      const phraseText = digest.key_phrases.join(', ');
      fragments.push({
        id: `${item.id}-phrases`,
        source_id: item.id,
        source_url: item.source_url,
        platform: item.platform,
        fragment_type: 'key_phrase',
        text: phraseText,
        vector: this.textToVector(phraseText),
        metadata: { phrase_count: digest.key_phrases.length },
        created_at: now,
      });
    }

    return fragments;
  }

  private textToVector(text: string): number[] {
    const vocab = this.buildVocabulary();
    const words = tokenize(text);
    const tf = computeTF(words);
    const vector = new Array(vocab.size).fill(0);

    let i = 0;
    for (const [term, _] of vocab) {
      if (tf.has(term)) {
        const tfVal = tf.get(term)!;
        const idf = this.computeIDF(term);
        vector[i] = tfVal * idf;
      }
      i++;
    }

    // L2 normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let j = 0; j < vector.length; j++) {
        vector[j] /= norm;
      }
    }

    return vector;
  }

  private buildVocabulary(): Map<string, number> {
    const vocab = new Map<string, number>();
    let idx = 0;

    for (const fragment of this.fragments) {
      for (const word of tokenize(fragment.text)) {
        if (!vocab.has(word)) {
          vocab.set(word, idx++);
        }
      }
    }

    return vocab;
  }

  private computeIDF(term: string): number {
    if (this.idfCache.has(term)) return this.idfCache.get(term)!;

    let docCount = 0;
    for (const fragment of this.fragments) {
      if (fragment.text.toLowerCase().includes(term)) docCount++;
    }

    const idf = Math.log(1 + (this.fragments.length || 1) / (1 + docCount));
    this.idfCache.set(term, idf);
    return idf;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function computeTF(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const maxFreq = Math.max(...freq.values(), 1);
  for (const [k, v] of freq) {
    freq.set(k, v / maxFreq);
  }
  return freq;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const minLen = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < minLen; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // Handle different lengths
  for (let i = minLen; i < a.length; i++) normA += a[i] * a[i];
  for (let i = minLen; i < b.length; i++) normB += b[i] * b[i];

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
