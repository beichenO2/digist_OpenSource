import type { ContentItem } from '../types/index.js';

export interface SourceQualityScore {
  platform: string;
  domain?: string;
  totalItems: number;
  avgDensity: number;
  freshness: number;
  uniqueness: number;
  overallScore: number;
}

export function evaluateSourceQuality(items: ContentItem[]): SourceQualityScore[] {
  const byPlatform = new Map<string, ContentItem[]>();
  for (const item of items) {
    const group = byPlatform.get(item.platform) ?? [];
    group.push(item);
    byPlatform.set(item.platform, group);
  }

  const scores: SourceQualityScore[] = [];

  for (const [platform, platformItems] of byPlatform) {
    const totalItems = platformItems.length;
    const avgDensity = calculateAvgDensity(platformItems);
    const freshness = calculateFreshness(platformItems);
    const uniqueness = calculateUniqueness(platformItems);
    const overallScore = avgDensity * 0.4 + freshness * 0.3 + uniqueness * 0.3;

    scores.push({
      platform,
      totalItems,
      avgDensity,
      freshness,
      uniqueness,
      overallScore,
    });
  }

  return scores.sort((a, b) => b.overallScore - a.overallScore);
}

function calculateAvgDensity(items: ContentItem[]): number {
  if (items.length === 0) return 0;

  let totalDensity = 0;
  for (const item of items) {
    const textLen = item.body_markdown.length;
    const titleLen = item.title.length;
    if (textLen === 0) continue;

    const wordCount = item.body_markdown.split(/\s+/).length;
    const sentenceCount = item.body_markdown.split(/[.!?。！？]+/).filter(Boolean).length;
    const avgSentenceLen = sentenceCount > 0 ? wordCount / sentenceCount : wordCount;

    const titleRatio = titleLen > 0 ? Math.min(titleLen / 200, 1) : 0;
    const lengthScore = Math.min(textLen / 2000, 1);
    const sentenceScore = avgSentenceLen > 5 && avgSentenceLen < 40 ? 1 : 0.5;

    totalDensity += (titleRatio * 0.3 + lengthScore * 0.4 + sentenceScore * 0.3);
  }

  return totalDensity / items.length;
}

function calculateFreshness(items: ContentItem[]): number {
  if (items.length === 0) return 0;

  const now = Date.now();
  const oneDay = 86400000;
  let totalFreshness = 0;

  for (const item of items) {
    const ts = new Date(item.timestamp).getTime();
    if (isNaN(ts)) continue;
    const ageMs = now - ts;
    const ageDays = ageMs / oneDay;
    totalFreshness += Math.max(0, 1 - ageDays / 30);
  }

  return totalFreshness / items.length;
}

function calculateUniqueness(items: ContentItem[]): number {
  if (items.length <= 1) return 1;

  const titles = items.map((i) => i.title.toLowerCase().trim());
  const uniqueTitles = new Set(titles);
  return uniqueTitles.size / titles.length;
}

export interface SearchCoverageResult {
  query: string;
  topK: number;
  results: number;
  coverageScore: number;
  gaps: string[];
}

export function evaluateSearchCoverage(
  query: string,
  results: ContentItem[],
  topK: number
): SearchCoverageResult {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const gaps: string[] = [];

  let matchedTerms = 0;
  for (const term of queryTerms) {
    const matched = results.some(
      (r) =>
        r.title.toLowerCase().includes(term) ||
        r.body_markdown.toLowerCase().includes(term)
    );
    if (matched) {
      matchedTerms++;
    } else {
      gaps.push(term);
    }
  }

  const termCoverage = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0;
  const resultCoverage = Math.min(results.length / topK, 1);
  const coverageScore = termCoverage * 0.6 + resultCoverage * 0.4;

  return {
    query,
    topK,
    results: results.length,
    coverageScore,
    gaps,
  };
}
