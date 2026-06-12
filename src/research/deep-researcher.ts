/**
 * Deep Researcher — autonomous gap-filling via web search + LLM reflection.
 *
 * Architecture (inspired by GPT Researcher + Tavily):
 *   Gap Detection → Planner (LLM) → Search (Firecrawl) → Reflect (LLM) → Distill → Ingest
 *
 * Integrations:
 *   - Knowledge graph gap detection (fusion/knowledge-graph.ts)
 *   - Firecrawl search (scrapers/firecrawl-scraper.ts)
 *   - LLM compression (digestion/context-compressor.ts)
 *   - Local LLM (utils/local-llm.ts)
 */

import type { ContentItem } from '../types/index.js';
import type { KnowledgeGap } from '../fusion/knowledge-graph.js';
import { generateText, isLlamaServerAvailable } from '../utils/local-llm.js';
import { firecrawlSearchScraper, isFirecrawlConfigured } from '../scrapers/firecrawl-scraper.js';
import { compressWithLLM } from '../digestion/context-compressor.js';

export interface ResearchPlan {
  gap: KnowledgeGap;
  queries: string[];
  rationale: string;
}

export interface ResearchResult {
  gap: KnowledgeGap;
  plan: ResearchPlan;
  findings: ContentItem[];
  digests: Array<{ source_url: string; summary: string }>;
  reflection: ReflectionResult;
  iterations: number;
}

export interface ReflectionResult {
  sufficient: boolean;
  coverage_score: number;
  remaining_gaps: string[];
  reasoning: string;
}

const MAX_ITERATIONS = 3;
const SEARCH_RESULTS_PER_QUERY = 5;

export async function researchGap(gap: KnowledgeGap): Promise<ResearchResult | null> {
  const llmOk = await isLlamaServerAvailable();
  if (!llmOk) {
    console.error('[DeepResearch] LLM unavailable, skipping research');
    return null;
  }

  if (!isFirecrawlConfigured()) {
    console.error('[DeepResearch] Firecrawl not configured (set FIRECRAWL_API_KEY or FIRECRAWL_API_URL)');
    return null;
  }

  const plan = await planResearch(gap);
  if (!plan || plan.queries.length === 0) return null;

  const allFindings: ContentItem[] = [];
  const allDigests: Array<{ source_url: string; summary: string }> = [];
  let queries = plan.queries;
  let iteration = 0;
  let reflection: ReflectionResult = { sufficient: false, coverage_score: 0, remaining_gaps: [], reasoning: '' };

  while (iteration < MAX_ITERATIONS && !reflection.sufficient) {
    iteration++;
    const roundFindings = await executeSearch(queries);
    allFindings.push(...roundFindings);

    for (const item of roundFindings) {
      try {
        const digest = await compressWithLLM(item);
        allDigests.push({
          source_url: item.source_url,
          summary: digest.compressed_markdown.slice(0, 500),
        });
      } catch {
        allDigests.push({ source_url: item.source_url, summary: item.title });
      }
    }

    reflection = await reflect(gap, allDigests);

    if (!reflection.sufficient && reflection.remaining_gaps.length > 0) {
      queries = await generateFollowUpQueries(reflection.remaining_gaps);
    }
  }

  return {
    gap,
    plan,
    findings: allFindings,
    digests: allDigests,
    reflection,
    iterations: iteration,
  };
}

export async function researchGaps(gaps: KnowledgeGap[]): Promise<ResearchResult[]> {
  const results: ResearchResult[] = [];
  const prioritized = gaps
    .filter(g => g.type === 'isolated-node' || g.type === 'sparse-community')
    .slice(0, 3);

  for (const gap of prioritized) {
    const result = await researchGap(gap);
    if (result) results.push(result);
  }
  return results;
}

async function planResearch(gap: KnowledgeGap): Promise<ResearchPlan | null> {
  try {
    const resp = await generateText(
      [
        `Knowledge Gap: ${gap.title}`,
        `Type: ${gap.type}`,
        `Description: ${gap.description}`,
        `Suggestion: ${gap.suggestion}`,
        `Related nodes: ${gap.nodeIds.slice(0, 5).join(', ')}`,
      ].join('\n'),
      {
        system: [
          'You are a research planner. Given a knowledge gap, generate search queries to fill it.',
          'Output EXACTLY this JSON (no markdown):',
          '{"queries":["search query 1","search query 2","search query 3"],',
          '"rationale":"why these queries will fill the gap"}',
          'Generate 2-4 diverse queries. Use English for technical topics.',
        ].join('\n'),
        maxTokens: 300,
        temperature: 0.3,
      },
    );

    const parsed = tryParseJSON(resp.text);
    if (!parsed?.queries) return null;

    return {
      gap,
      queries: Array.isArray(parsed.queries) ? parsed.queries.map(String).slice(0, 4) : [],
      rationale: String(parsed.rationale || ''),
    };
  } catch (err) {
    console.error(`[DeepResearch] Planning failed: ${err}`);
    return null;
  }
}

async function executeSearch(queries: string[]): Promise<ContentItem[]> {
  const results: ContentItem[] = [];

  for (const query of queries) {
    try {
      const { items } = await firecrawlSearchScraper.scrape(query, {
        maxItems: SEARCH_RESULTS_PER_QUERY,
      });
      results.push(...items);
    } catch (err) {
      console.error(`[DeepResearch] Search failed for "${query}": ${err}`);
    }
  }

  const seen = new Set<string>();
  return results.filter(item => {
    if (!item.source_url || seen.has(item.source_url)) return false;
    seen.add(item.source_url);
    return true;
  });
}

async function reflect(
  gap: KnowledgeGap,
  digests: Array<{ source_url: string; summary: string }>,
): Promise<ReflectionResult> {
  try {
    const digestSummary = digests
      .slice(0, 10)
      .map((d, i) => `[${i + 1}] ${d.summary.slice(0, 200)}`)
      .join('\n');

    const resp = await generateText(
      [
        `Original knowledge gap: ${gap.title} — ${gap.description}`,
        '',
        `Gathered ${digests.length} sources:`,
        digestSummary,
      ].join('\n'),
      {
        system: [
          'Evaluate whether the gathered information sufficiently fills the knowledge gap.',
          'Output EXACTLY this JSON (no markdown):',
          '{"sufficient":true/false,"coverage_score":0.0-1.0,',
          '"remaining_gaps":["gap still unfilled 1"],',
          '"reasoning":"explanation of assessment"}',
        ].join('\n'),
        maxTokens: 300,
        temperature: 0.2,
      },
    );

    const parsed = tryParseJSON(resp.text);
    if (!parsed) {
      return { sufficient: digests.length >= 5, coverage_score: 0.5, remaining_gaps: [], reasoning: 'parse failed' };
    }

    return {
      sufficient: !!parsed.sufficient,
      coverage_score: Number(parsed.coverage_score) || 0,
      remaining_gaps: Array.isArray(parsed.remaining_gaps) ? parsed.remaining_gaps.map(String) : [],
      reasoning: String(parsed.reasoning || ''),
    };
  } catch {
    return { sufficient: digests.length >= 5, coverage_score: 0.5, remaining_gaps: [], reasoning: 'reflection failed' };
  }
}

async function generateFollowUpQueries(remainingGaps: string[]): Promise<string[]> {
  try {
    const resp = await generateText(
      `Remaining knowledge gaps:\n${remainingGaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}`,
      {
        system: 'Generate 2 targeted search queries to fill these remaining gaps. Output JSON: {"queries":["q1","q2"]}',
        maxTokens: 150,
        temperature: 0.3,
      },
    );
    const parsed = tryParseJSON(resp.text);
    return Array.isArray(parsed?.queries) ? parsed.queries.map(String) : [];
  } catch {
    return remainingGaps.map(g => g.slice(0, 100));
  }
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
