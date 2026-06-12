import type { ContentItem } from '../types/index.js';
import { compressContent, type CompressedDigest } from '../digestion/context-compressor.js';

export interface SemanticLink {
  source_id: string;
  target_id: string;
  link_type: 'topic_overlap' | 'entity_shared' | 'temporal_proximity' | 'causal_chain' | 'same_event';
  strength: number;
  evidence: string[];
}

export interface LinkDiscoveryReport {
  total_links: number;
  strong_links: number;
  cross_platform_links: number;
  link_types: Record<string, number>;
  links: SemanticLink[];
  suggested_connections: string[];
}

export function discoverLinks(items: ContentItem[]): LinkDiscoveryReport {
  const digests = items.map(item => ({
    item,
    digest: compressContent(item),
  }));

  const links: SemanticLink[] = [];

  for (let i = 0; i < digests.length; i++) {
    for (let j = i + 1; j < digests.length; j++) {
      const discovered = findLinksBetween(
        digests[i].item, digests[i].digest,
        digests[j].item, digests[j].digest,
      );
      links.push(...discovered);
    }
  }

  const linkTypes: Record<string, number> = {};
  for (const link of links) {
    linkTypes[link.link_type] = (linkTypes[link.link_type] || 0) + 1;
  }

  const crossPlatform = links.filter(link => {
    const srcItem = items.find(i => i.id === link.source_id);
    const tgtItem = items.find(i => i.id === link.target_id);
    return srcItem && tgtItem && srcItem.platform !== tgtItem.platform;
  }).length;

  const suggestions = generateConnectionSuggestions(digests);

  return {
    total_links: links.length,
    strong_links: links.filter(l => l.strength > 0.6).length,
    cross_platform_links: crossPlatform,
    link_types: linkTypes,
    links: links.sort((a, b) => b.strength - a.strength),
    suggested_connections: suggestions,
  };
}

function findLinksBetween(
  itemA: ContentItem, digestA: CompressedDigest,
  itemB: ContentItem, digestB: CompressedDigest,
): SemanticLink[] {
  const links: SemanticLink[] = [];

  // Topic overlap
  const topicOverlap = computeTopicOverlap(digestA, digestB);
  if (topicOverlap > 0.2) {
    const shared = digestA.key_phrases.filter(p =>
      digestB.key_phrases.some(q => p.toLowerCase() === q.toLowerCase())
    );
    links.push({
      source_id: itemA.id,
      target_id: itemB.id,
      link_type: 'topic_overlap',
      strength: topicOverlap,
      evidence: shared.length > 0 ? [`Shared topics: ${shared.join(', ')}`] : ['Keyword overlap detected'],
    });
  }

  // Entity sharing
  const sharedEntities = findSharedEntities(digestA, digestB);
  if (sharedEntities.length > 0) {
    links.push({
      source_id: itemA.id,
      target_id: itemB.id,
      link_type: 'entity_shared',
      strength: Math.min(sharedEntities.length * 0.15, 0.9),
      evidence: sharedEntities.map(e => `Shared entity: ${e}`),
    });
  }

  // Temporal proximity
  const timeDiffHours = Math.abs(
    new Date(itemA.timestamp).getTime() - new Date(itemB.timestamp).getTime()
  ) / (1000 * 60 * 60);

  if (timeDiffHours < 24 && topicOverlap > 0.1) {
    links.push({
      source_id: itemA.id,
      target_id: itemB.id,
      link_type: 'temporal_proximity',
      strength: Math.max(0.3, 1 - timeDiffHours / 24) * topicOverlap,
      evidence: [`Published within ${timeDiffHours.toFixed(1)} hours of each other`],
    });
  }

  // Same event detection
  if (topicOverlap > 0.5 && timeDiffHours < 48 && sharedEntities.length >= 2) {
    links.push({
      source_id: itemA.id,
      target_id: itemB.id,
      link_type: 'same_event',
      strength: Math.min(topicOverlap + sharedEntities.length * 0.1, 0.95),
      evidence: ['Multiple shared entities and topics within 48h window'],
    });
  }

  return links;
}

function computeTopicOverlap(digestA: CompressedDigest, digestB: CompressedDigest): number {
  const wordsA = new Set(
    digestA.summary_sentences.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  const wordsB = new Set(
    digestB.summary_sentences.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findSharedEntities(digestA: CompressedDigest, digestB: CompressedDigest): string[] {
  const entitiesA = new Set(digestA.entities.map(e => e.text.toLowerCase()));
  const entitiesB = new Set(digestB.entities.map(e => e.text.toLowerCase()));

  const shared: string[] = [];
  for (const e of entitiesA) {
    if (entitiesB.has(e)) shared.push(e);
  }
  return shared;
}

function generateConnectionSuggestions(
  digests: Array<{ item: ContentItem; digest: CompressedDigest }>,
): string[] {
  const suggestions: string[] = [];

  // Find topics only covered by one platform
  const topicPlatforms = new Map<string, Set<string>>();
  for (const { item, digest } of digests) {
    for (const phrase of digest.key_phrases) {
      const key = phrase.toLowerCase();
      if (!topicPlatforms.has(key)) topicPlatforms.set(key, new Set());
      topicPlatforms.get(key)!.add(item.platform);
    }
  }

  for (const [topic, platforms] of topicPlatforms) {
    if (platforms.size === 1) {
      const platform = [...platforms][0];
      const otherPlatforms = new Set<string>(digests.map(d => d.item.platform));
      otherPlatforms.delete(platform);
      if (otherPlatforms.size > 0) {
        suggestions.push(
          `Topic "${topic}" only found on ${platform}. Consider searching ${[...otherPlatforms].join(', ')}.`
        );
      }
    }
  }

  // Find entities that appear frequently but lack context
  const entityFreqs = new Map<string, number>();
  for (const { digest } of digests) {
    for (const entity of digest.entities) {
      const key = entity.text.toLowerCase();
      entityFreqs.set(key, (entityFreqs.get(key) || 0) + entity.frequency);
    }
  }

  const highFreqEntities = [...entityFreqs.entries()]
    .filter(([_, freq]) => freq >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [entity, freq] of highFreqEntities) {
    suggestions.push(`Entity "${entity}" mentioned ${freq}x — consider deep-diving for more context.`);
  }

  return suggestions.slice(0, 10);
}
