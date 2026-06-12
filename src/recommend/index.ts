/**
 * Personalized recommendation engine for DiGist.
 *
 * Replaces platform recommendation algorithms with user-interest-driven,
 * cross-platform content ranking using:
 * - Interest graph matching (user interests → content relevance)
 * - Information density scoring (quality signal)
 * - Source reliability (conflict-aware trust)
 * - Cross-platform bridging (content appearing on multiple platforms)
 * - Temporal freshness decay
 * - Novelty boost (content from underexplored topics)
 */
import type { ContentItem } from '../types/index.js';
import { evaluateDensity } from '../digestion/density-evaluator.js';
import { KnowledgeGraph } from '../fusion/knowledge-graph.js';
import { KnowledgeIndex } from '../digestion/knowledge-index.js';
import { Storage } from '../storage/index.js';

export interface RecommendOptions {
  userId?: string;            // filter interests by user (default: all)
  maxItems?: number;
  platforms?: string[];
  freshnessBias?: number;     // 0-1, higher = prefer newer (default 0.5)
  diversityBias?: number;     // 0-1, higher = more platform diversity (default 0.3)
  interestIds?: string[];     // filter by specific interests
  excludeRead?: string[];     // item IDs to exclude
  customKeywords?: string[];  // user-specified interest keywords (matched against full text)
  weights?: Partial<SignalWeights>;
}

export interface SignalWeights {
  relevance: number;
  density: number;
  freshness: number;
  crossPlatform: number;
  novelty: number;
}

export interface RankedItem {
  item: ContentItem;
  score: number;
  signals: {
    relevance: number;
    density: number;
    freshness: number;
    crossPlatform: number;
    novelty: number;
  };
  reason: string;
  contentType: string;
  sourceType: string;
  digestStatus: string;
  mediaStatus: string | null;
  tempDocId: string | null;
  localPlayUrl: string | null;
  watchUrl: string | null;
}

export class Recommender {
  private storage: Storage;
  private graph: KnowledgeGraph;
  private index: KnowledgeIndex;

  constructor(storage: Storage, graph?: KnowledgeGraph, index?: KnowledgeIndex) {
    this.storage = storage;
    this.graph = graph || new KnowledgeGraph();
    this.index = index || new KnowledgeIndex();
  }

  buildProfile(): void {
    const items = this.storage.listContent(undefined, 50);
    if (items.length === 0) return;
    this.graph.addBatch(items);
    this.index.ingestBatch(items);
  }

  recommend(options: RecommendOptions = {}): RankedItem[] {
    const {
      maxItems = 20,
      platforms,
      freshnessBias = 0.5,
      diversityBias = 0.3,
      excludeRead = [],
      customKeywords = [],
    } = options;

    const w: SignalWeights = {
      relevance: 0.35,
      density: 0.20,
      freshness: 0.20,
      crossPlatform: 0.15,
      novelty: 0.10,
      ...options.weights,
    };
    const wTotal = w.relevance + w.density + w.freshness + w.crossPlatform + w.novelty || 1;

    const interests = options.interestIds
      ? options.interestIds.map(id => this.storage.getInterest(id)).filter(Boolean)
      : this.storage.listInterests(options.userId);

    const interestQueries: string[] = [
      ...interests.filter(i => i && i.enabled && i.query).map(i => i!.query!).filter((q): q is string => typeof q === 'string'),
      ...customKeywords,
    ];

    let candidates = this.storage.listContent(undefined, 1000);
    if (platforms?.length) {
      candidates = candidates.filter(item => platforms.includes(item.platform));
    }
    if (excludeRead.length) {
      const excludeSet = new Set(excludeRead);
      candidates = candidates.filter(item => !excludeSet.has(item.id));
    }

    const feedbackMap = this.storage.getFeedbackForItems(candidates.map(c => c.id));

    const hubs = this.graph.getHubs(20);
    const hubLabels = new Set(hubs.filter(h => h.label).map(h => h.label.toLowerCase()));
    const bridging = this.graph.findBridgingEntities();
    const bridgingLabels = new Set(bridging.slice(0, 30).filter(b => b.label).map(b => b.label.toLowerCase()));

    const now = Date.now();
    const ranked: RankedItem[] = [];

    for (const item of candidates) {
      const feedbacks = feedbackMap.get(item.id) || [];
      const hasNegative = feedbacks.some(f => f.action === 'not_interested');
      if (hasNegative) continue;

      const relevance = this.computeRelevance(item, interestQueries, hubLabels);
      const density = this.computeDensity(item);
      const freshness = this.computeFreshness(item, now, freshnessBias);
      const crossPlatform = this.computeCrossPlatform(item, bridgingLabels);
      const novelty = this.computeNovelty(item, hubLabels);

      let rawScore =
        (relevance * w.relevance +
        density * w.density +
        freshness * w.freshness +
        crossPlatform * w.crossPlatform +
        novelty * w.novelty) / wTotal;

      if (feedbacks.some(f => f.action === 'archive')) {
        rawScore *= 0.3;
      }

      const score = Number.isFinite(rawScore) ? rawScore : 0;
      const reason = this.explainRanking(item, { relevance, density, freshness, crossPlatform, novelty });

      const meta = (item.raw_metadata || {}) as Record<string, unknown>;
      const itemAny = item as unknown as Record<string, unknown>;

      ranked.push({
        item,
        score,
        signals: { relevance, density, freshness, crossPlatform, novelty },
        reason,
        contentType: (itemAny.content_type as string) || (meta.content_type as string) || inferContentType(item),
        sourceType: (itemAny.source_type as string) || (meta.source_type as string) || 'api_crawl',
        digestStatus: (itemAny.digest_status as string) || 'collected',
        mediaStatus: (itemAny.media_status as string | null) || null,
        tempDocId: (itemAny.temp_doc_id as string | null) || null,
        localPlayUrl: (itemAny.local_play_url as string | null) || null,
        watchUrl: item.source_url || null,
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    if (diversityBias > 0) {
      return this.diversify(ranked, maxItems, diversityBias);
    }

    return ranked.slice(0, maxItems);
  }

  forYou(options: RecommendOptions = {}): RankedItem[] {
    return this.recommend(options);
  }

  private computeRelevance(
    item: ContentItem,
    interestQueries: string[],
    hubLabels: Set<string>,
  ): number {
    const text = `${item.title} ${item.body_markdown || ''}`.toLowerCase();

    let interestScore = 0;
    if (interestQueries.length > 0) {
      let score = 0;
      for (const q of interestQueries) {
        const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const matched = words.filter(w => text.includes(w)).length;
        score += matched / Math.max(words.length, 1);
      }
      interestScore = score / interestQueries.length;
    }

    let hubHits = 0;
    for (const hub of hubLabels) {
      if (hub.length > 2 && text.includes(hub)) hubHits++;
    }
    const hubScore = Math.min(hubHits / 5, 1);

    if (interestQueries.length === 0) {
      return hubScore > 0 ? hubScore : 0.5;
    }
    return interestScore * 0.6 + hubScore * 0.4;
  }

  private computeDensity(item: ContentItem): number {
    try {
      const d = evaluateDensity(item);
      const score = d.overall;
      if (!Number.isFinite(score)) return 0.3;
      return Math.min(Math.max(score / 100, 0), 1);
    } catch {
      return 0.3;
    }
  }

  private computeFreshness(item: ContentItem, now: number, bias: number): number {
    const ts = new Date(item.timestamp || item.scraped_at).getTime();
    const ageHours = (now - ts) / (1000 * 60 * 60);

    if (ageHours < 1) return 1.0;
    if (ageHours < 6) return 0.9;
    if (ageHours < 24) return 0.7;
    if (ageHours < 72) return 0.5;
    if (ageHours < 168) return 0.3;
    return 0.1;
  }

  private computeCrossPlatform(item: ContentItem, bridgingLabels: Set<string>): number {
    const text = `${item.title} ${item.body_markdown || ''}`.toLowerCase();
    let hits = 0;
    for (const label of bridgingLabels) {
      if (text.includes(label)) hits++;
    }
    return Math.min(hits / 3, 1);
  }

  private computeNovelty(item: ContentItem, hubLabels: Set<string>): number {
    const text = `${item.title} ${item.body_markdown || ''}`.toLowerCase();
    let hubHits = 0;
    for (const hub of hubLabels) {
      if (text.includes(hub)) hubHits++;
    }
    return hubHits > 3 ? 0.2 : hubHits === 0 ? 0.8 : 1 - (hubHits * 0.15);
  }

  private diversify(ranked: RankedItem[], maxItems: number, bias: number): RankedItem[] {
    const result: RankedItem[] = [];
    const platformCounts: Record<string, number> = {};
    const maxPerPlatform = Math.ceil(maxItems / 3);

    for (const item of ranked) {
      if (result.length >= maxItems) break;

      const p = item.item.platform;
      const count = platformCounts[p] || 0;

      if (count >= maxPerPlatform && bias > 0.5) continue;

      const penalty = count > 0 ? count * bias * 0.1 : 0;
      item.score -= penalty;

      result.push(item);
      platformCounts[p] = count + 1;
    }

    result.sort((a, b) => b.score - a.score);
    return result;
  }

  private explainRanking(
    item: ContentItem,
    signals: { relevance: number; density: number; freshness: number; crossPlatform: number; novelty: number },
  ): string {
    const parts: string[] = [];
    const best = Object.entries(signals).sort((a, b) => b[1] - a[1]);

    for (const [key, val] of best.slice(0, 2)) {
      if (val >= 0.7) {
        const names: Record<string, string> = {
          relevance: '兴趣匹配度高',
          density: '信息密度高',
          freshness: '新鲜度高',
          crossPlatform: '跨平台热点',
          novelty: '新颖话题',
        };
        parts.push(names[key] || key);
      }
    }

    return parts.length > 0 ? parts.join('、') : `${item.platform} 内容`;
  }
}

function inferContentType(item: ContentItem): string {
  const videoPlatforms = new Set(['bilibili', 'youtube']);
  if (videoPlatforms.has(item.platform)) return 'video';
  if (item.platform === 'arxiv') return 'pdf';
  const url = item.source_url || '';
  if (url.match(/\.(mp4|webm|mkv)/i)) return 'video';
  if (url.match(/\.(mp3|wav|flac)/i)) return 'audio';
  if (url.match(/\.pdf$/i)) return 'pdf';
  return 'text';
}
