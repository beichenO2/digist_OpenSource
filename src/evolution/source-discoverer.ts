import { KnowledgeGraph } from '../fusion/knowledge-graph.js';
import { KnowledgeIndex } from '../digestion/knowledge-index.js';
import type { ContentItem } from '../types/index.js';

export interface DiscoveredSource {
  platform: ContentItem['platform'];
  query: string;
  reason: string;
  confidence: number;
  gap_area: string;
}

export class SourceDiscoverer {
  private graph: KnowledgeGraph;
  private index: KnowledgeIndex;

  constructor(graph: KnowledgeGraph, index: KnowledgeIndex) {
    this.graph = graph;
    this.index = index;
  }

  discoverNewSources(existingItems: ContentItem[]): DiscoveredSource[] {
    const discoveries: DiscoveredSource[] = [];

    // Strategy 1: Platform gap analysis
    discoveries.push(...this.findPlatformGaps(existingItems));

    // Strategy 2: Entity expansion
    discoveries.push(...this.findEntityExpansions(existingItems));

    // Strategy 3: Topic frontier exploration
    discoveries.push(...this.findTopicFrontiers(existingItems));

    // Strategy 4: Temporal gap filling
    discoveries.push(...this.findTemporalGaps(existingItems));

    return discoveries
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);
  }

  private findPlatformGaps(items: ContentItem[]): DiscoveredSource[] {
    const results: DiscoveredSource[] = [];
    const platformTopics = new Map<string, Set<string>>();

    for (const item of items) {
      if (!platformTopics.has(item.platform)) {
        platformTopics.set(item.platform, new Set());
      }
      const words = item.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      for (const w of words) {
        platformTopics.get(item.platform)!.add(w);
      }
    }

    const allPlatforms: ContentItem['platform'][] = ['twitter', 'reddit', 'wechat'];
    const coveredPlatforms = [...platformTopics.keys()];

    // Find topics covered on one platform but not others
    for (const [platform, topics] of platformTopics) {
      for (const otherPlatform of allPlatforms) {
        if (otherPlatform === platform) continue;
        const otherTopics = platformTopics.get(otherPlatform) || new Set();
        const gaps = [...topics].filter(t => !otherTopics.has(t));

        if (gaps.length > 0) {
          results.push({
            platform: otherPlatform,
            query: gaps.slice(0, 3).join(' '),
            reason: `Topic "${gaps[0]}" found on ${platform} but not ${otherPlatform}`,
            confidence: 0.6,
            gap_area: 'platform_coverage',
          });
        }
      }
    }

    // Completely uncovered platforms
    for (const platform of allPlatforms) {
      if (!coveredPlatforms.includes(platform)) {
        const topTopics = [...(platformTopics.values().next().value || [])].slice(0, 3);
        results.push({
          platform,
          query: topTopics.join(' ') || 'AI technology',
          reason: `Platform ${platform} has no coverage yet`,
          confidence: 0.8,
          gap_area: 'platform_coverage',
        });
      }
    }

    return results;
  }

  private findEntityExpansions(items: ContentItem[]): DiscoveredSource[] {
    const results: DiscoveredSource[] = [];
    const stats = this.graph.getStats();

    // Find high-weight entities that could be explored deeper
    const hubs = this.graph.getHubs(10);
    for (const hub of hubs) {
      if (hub.type === 'entity' && hub.weight > 3) {
        const searchResults = this.index.search(hub.label, 5);
        const platforms = new Set(searchResults.map(r => r.fragment.platform));

        if (platforms.size < 2) {
          const uncoveredPlatforms: ContentItem['platform'][] = ['twitter', 'reddit', 'wechat']
            .filter(p => !platforms.has(p)) as ContentItem['platform'][];

          for (const platform of uncoveredPlatforms.slice(0, 1)) {
            results.push({
              platform,
              query: hub.label,
              reason: `High-importance entity "${hub.label}" (weight: ${hub.weight}) only covered on ${[...platforms].join(', ')}`,
              confidence: 0.7,
              gap_area: 'entity_depth',
            });
          }
        }
      }
    }

    // Find bridging entities that need more context
    const bridges = this.graph.findBridgingEntities();
    for (const bridge of bridges.slice(0, 5)) {
      results.push({
        platform: 'twitter',
        query: `${bridge.label} latest`,
        reason: `Bridging entity "${bridge.label}" connects multiple domains — worth monitoring`,
        confidence: 0.5,
        gap_area: 'entity_context',
      });
    }

    return results;
  }

  private findTopicFrontiers(items: ContentItem[]): DiscoveredSource[] {
    const results: DiscoveredSource[] = [];

    // Find topics at the "edge" of the knowledge graph
    const clusters = this.graph.getClusters();
    const smallClusters = [...clusters.entries()]
      .filter(([_, members]) => members.length >= 2 && members.length <= 5)
      .slice(0, 5);

    for (const [label, members] of smallClusters) {
      const topicNodes = members.filter(id => id.startsWith('topic:'));
      if (topicNodes.length > 0) {
        const topicName = topicNodes[0].replace('topic:', '').replace(/_/g, ' ');
        results.push({
          platform: 'reddit',
          query: topicName,
          reason: `Small cluster "${topicName}" has limited coverage — frontier topic`,
          confidence: 0.5,
          gap_area: 'topic_frontier',
        });
      }
    }

    return results;
  }

  private findTemporalGaps(items: ContentItem[]): DiscoveredSource[] {
    const results: DiscoveredSource[] = [];

    // Sort by timestamp
    const sorted = [...items].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (sorted.length < 2) return results;

    // Check for large time gaps
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapHours = (
        new Date(sorted[i + 1].timestamp).getTime() -
        new Date(sorted[i].timestamp).getTime()
      ) / (1000 * 60 * 60);

      if (gapHours > 48) {
        const midTime = new Date(
          (new Date(sorted[i].timestamp).getTime() + new Date(sorted[i + 1].timestamp).getTime()) / 2
        );

        results.push({
          platform: sorted[i].platform as ContentItem['platform'],
          query: sorted[i].title.split(/\s+/).slice(0, 3).join(' '),
          reason: `${gapHours.toFixed(0)}h gap in coverage around ${midTime.toISOString().slice(0, 10)}`,
          confidence: 0.4,
          gap_area: 'temporal_gap',
        });
      }
    }

    return results;
  }
}
