import type { ContentItem } from '../types/index.js';

export interface DensityReport {
  overall: number;
  lexical_diversity: number;
  semantic_richness: number;
  structural_complexity: number;
  information_uniqueness: number;
  content_length_score: number;
  details: Record<string, number>;
}

export function evaluateDensity(item: ContentItem, corpus?: ContentItem[]): DensityReport {
  const text = item.body_markdown;

  const lexical = computeLexicalDiversity(text);
  const semantic = computeSemanticRichness(text);
  const structural = computeStructuralComplexity(text);
  const lengthScore = computeLengthScore(text);
  const uniqueness = corpus ? computeUniqueness(text, corpus) : 0.5;

  const overall = (
    lexical * 0.2 +
    semantic * 0.25 +
    structural * 0.15 +
    lengthScore * 0.15 +
    uniqueness * 0.25
  );

  return {
    overall: clamp(overall),
    lexical_diversity: clamp(lexical),
    semantic_richness: clamp(semantic),
    structural_complexity: clamp(structural),
    information_uniqueness: clamp(uniqueness),
    content_length_score: clamp(lengthScore),
    details: {
      word_count: text.split(/\s+/).filter(Boolean).length,
      unique_words: new Set(text.toLowerCase().split(/\s+/).filter(Boolean)).size,
      sentence_count: text.split(/[.!?。！？]+/).filter(Boolean).length,
      paragraph_count: text.split(/\n\n+/).filter(Boolean).length,
      code_blocks: (text.match(/```/g) || []).length / 2,
      links: (text.match(/\[.*?\]\(.*?\)/g) || []).length,
      images: (text.match(/!\[.*?\]\(.*?\)/g) || []).length,
      headers: (text.match(/^#{1,6}\s/gm) || []).length,
      entities_estimate: extractEntities(text).length,
    },
  };
}

function computeLexicalDiversity(text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length < 5) return 0;

  const unique = new Set(words);
  const ttr = unique.size / words.length; // type-token ratio

  // Hapax legomena ratio (words appearing exactly once)
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const hapax = [...freq.values()].filter(v => v === 1).length;
  const hapaxRatio = hapax / unique.size;

  return ttr * 0.6 + hapaxRatio * 0.4;
}

function computeSemanticRichness(text: string): number {
  const entities = extractEntities(text);
  const claims = extractClaims(text);
  const technicalTerms = extractTechnicalTerms(text);

  const words = text.split(/\s+/).length || 1;
  const entityDensity = Math.min(entities.length / (words / 20), 1);
  const claimDensity = Math.min(claims.length / (words / 50), 1);
  const techDensity = Math.min(technicalTerms.length / (words / 30), 1);

  return entityDensity * 0.35 + claimDensity * 0.35 + techDensity * 0.3;
}

function computeStructuralComplexity(text: string): number {
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
  const links = (text.match(/\[.*?\]\(.*?\)/g) || []).length;
  const images = (text.match(/!\[.*?\]\(.*?\)/g) || []).length;
  const headers = (text.match(/^#{1,6}\s/gm) || []).length;
  const lists = (text.match(/^[-*]\s/gm) || []).length;
  const tables = (text.match(/\|.*\|/gm) || []).length;

  const totalElements = codeBlocks * 3 + links * 2 + images * 1.5 + headers * 1 + lists * 0.5 + tables * 2;
  const paragraphs = text.split(/\n\n+/).filter(Boolean).length || 1;

  return Math.min(totalElements / (paragraphs * 3), 1);
}

function computeLengthScore(text: string): number {
  const len = text.length;
  if (len < 50) return 0.1;
  if (len < 200) return 0.3;
  if (len < 500) return 0.5;
  if (len < 2000) return 0.8;
  if (len < 5000) return 1.0;
  return Math.max(0.7, 1.0 - (len - 5000) / 20000); // slight penalty for very long
}

function computeUniqueness(text: string, corpus: ContentItem[]): number {
  if (corpus.length === 0) return 1.0;

  const words = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  let maxOverlap = 0;

  for (const other of corpus) {
    const otherWords = new Set(other.body_markdown.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of words) {
      if (otherWords.has(w)) overlap++;
    }
    const jaccardSim = overlap / (words.size + otherWords.size - overlap);
    maxOverlap = Math.max(maxOverlap, jaccardSim);
  }

  return 1 - maxOverlap;
}

function extractEntities(text: string): string[] {
  const entities: string[] = [];

  // Capitalized multi-word names
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let match;
  while ((match = namePattern.exec(text)) !== null) {
    entities.push(match[1]);
  }

  // @mentions
  const mentions = text.match(/@\w+/g) || [];
  entities.push(...mentions);

  // URLs as entities
  const urls = text.match(/https?:\/\/[^\s)\]]+/g) || [];
  entities.push(...urls.map(u => { try { return new URL(u).hostname; } catch { return ''; } }).filter(Boolean));

  // Numbers with units
  const numbers = text.match(/\d+(?:\.\d+)?(?:\s*(?:%|ms|s|GB|MB|KB|k|M|B))/g) || [];
  entities.push(...numbers);

  return [...new Set(entities)];
}

function extractClaims(text: string): string[] {
  const sentences = text.split(/[.!?。！？]+/).map(s => s.trim()).filter(s => s.length > 20);
  return sentences.filter(s => {
    const lower = s.toLowerCase();
    return (
      /\b(is|are|was|were|can|will|should|must|need|require|enable|allow|support|provide|implement|build|create)\b/.test(lower) &&
      !lower.startsWith('if ') &&
      !lower.startsWith('when ') &&
      s.split(/\s+/).length >= 5
    );
  });
}

function extractTechnicalTerms(text: string): string[] {
  const techPatterns = [
    /\b[A-Z][a-zA-Z]*(?:API|SDK|CLI|UI|DB|ML|AI|LLM|NLP|RAG)\b/g,
    /\b(?:async|await|function|class|interface|import|export|const|let|var)\b/g,
    /\b(?:HTTP|REST|GraphQL|WebSocket|TCP|UDP|DNS|SSL|TLS)\b/g,
    /\b(?:Docker|Kubernetes|Redis|PostgreSQL|MongoDB|SQLite|MySQL)\b/g,
    /\b(?:React|Vue|Angular|Node|Deno|Bun|Next|Nuxt)\b/g,
    /\b(?:TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+)\b/g,
  ];

  const terms: string[] = [];
  for (const pattern of techPatterns) {
    const matches = text.match(pattern) || [];
    terms.push(...matches);
  }
  return [...new Set(terms)];
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;
}

export function filterByDensity(items: ContentItem[], threshold = 0.3): ContentItem[] {
  return items.filter(item => evaluateDensity(item).overall >= threshold);
}

export function rankByDensity(items: ContentItem[]): Array<ContentItem & { density: number }> {
  return items
    .map(item => ({ ...item, density: evaluateDensity(item).overall }))
    .sort((a, b) => b.density - a.density);
}
