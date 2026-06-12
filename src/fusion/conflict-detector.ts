import type { ContentItem } from '../types/index.js';
import { compressContent, type Claim } from '../digestion/context-compressor.js';

export interface ConflictReport {
  total_conflicts: number;
  conflicts: Conflict[];
  consensus_items: ConsensusItem[];
  reliability_scores: Map<string, number>;
}

export interface Conflict {
  topic: string;
  claims: ConflictingClaim[];
  severity: 'high' | 'medium' | 'low';
  resolution_hint: string;
}

interface ConflictingClaim {
  claim_text: string;
  source_url: string;
  platform: string;
  confidence: number;
  author: string;
}

interface ConsensusItem {
  claim: string;
  sources: Array<{ url: string; platform: string }>;
  agreement_level: number;
}

export function detectConflicts(items: ContentItem[]): ConflictReport {
  const digests = items.map(item => ({
    item,
    digest: compressContent(item),
  }));

  const conflicts: Conflict[] = [];
  const consensusMap = new Map<string, ConsensusItem>();

  // Group claims by topic similarity
  const claimGroups = groupClaimsByTopic(digests);

  for (const [topic, claims] of claimGroups) {
    if (claims.length < 2) continue;

    const hasConflict = findConflictsInGroup(claims);
    if (hasConflict.length > 0) {
      const severity = determineSeverity(hasConflict);
      const hint = generateResolutionHint(topic, hasConflict);
      conflicts.push({
        topic,
        claims: hasConflict,
        severity,
        resolution_hint: hint,
      });
    } else {
      // All claims agree — consensus
      const agreement = claims.length / digests.length;
      consensusMap.set(topic, {
        claim: claims[0].claim_text,
        sources: claims.map(c => ({ url: c.source_url, platform: c.platform })),
        agreement_level: agreement,
      });
    }
  }

  const reliabilityScores = computeSourceReliability(items, conflicts);

  return {
    total_conflicts: conflicts.length,
    conflicts: conflicts.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity)),
    consensus_items: [...consensusMap.values()].sort((a, b) => b.agreement_level - a.agreement_level),
    reliability_scores: reliabilityScores,
  };
}

function groupClaimsByTopic(
  digests: Array<{ item: ContentItem; digest: ReturnType<typeof compressContent> }>,
): Map<string, ConflictingClaim[]> {
  const groups = new Map<string, ConflictingClaim[]>();

  for (const { item, digest } of digests) {
    for (const claim of digest.claims) {
      const topic = extractTopic(claim.text);
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic)!.push({
        claim_text: claim.text,
        source_url: item.source_url,
        platform: item.platform,
        confidence: claim.confidence,
        author: item.author,
      });
    }
  }

  // Merge similar topics
  const mergedGroups = new Map<string, ConflictingClaim[]>();
  const processed = new Set<string>();

  for (const [topicA, claimsA] of groups) {
    if (processed.has(topicA)) continue;
    processed.add(topicA);

    const merged = [...claimsA];
    for (const [topicB, claimsB] of groups) {
      if (processed.has(topicB)) continue;
      if (topicSimilarity(topicA, topicB) > 0.5) {
        merged.push(...claimsB);
        processed.add(topicB);
      }
    }
    mergedGroups.set(topicA, merged);
  }

  return mergedGroups;
}

function extractTopic(claimText: string): string {
  const words = claimText.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3);

  const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'they', 'their', 'there', 'about', 'which', 'would', 'could', 'should']);
  const significant = words.filter(w => !stopWords.has(w));

  return significant.slice(0, 4).join(' ');
}

function topicSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const union = wordsA.size + wordsB.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

function findConflictsInGroup(claims: ConflictingClaim[]): ConflictingClaim[] {
  const negationPatterns = [
    { pos: /\bis\b/i, neg: /\bis not\b|\bisn't\b/i },
    { pos: /\bcan\b/i, neg: /\bcannot\b|\bcan't\b/i },
    { pos: /\bwill\b/i, neg: /\bwill not\b|\bwon't\b/i },
    { pos: /\bshould\b/i, neg: /\bshould not\b|\bshouldn't\b/i },
    { pos: /\bgood\b|\bbetter\b|\bbest\b/i, neg: /\bbad\b|\bworse\b|\bworst\b/i },
    { pos: /\bfast\b|\bfaster\b/i, neg: /\bslow\b|\bslower\b/i },
    { pos: /\bsafe\b|\bsecure\b/i, neg: /\bunsafe\b|\binsecure\b/i },
    { pos: /\beasy\b|\bsimple\b/i, neg: /\bhard\b|\bdifficult\b|\bcomplex\b/i },
    { pos: /\bincrease\b|\bgrow\b/i, neg: /\bdecrease\b|\bshrink\b|\bdecline\b/i },
  ];

  const conflicting: ConflictingClaim[] = [];

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const textA = claims[i].claim_text;
      const textB = claims[j].claim_text;

      for (const { pos, neg } of negationPatterns) {
        if ((pos.test(textA) && neg.test(textB)) || (neg.test(textA) && pos.test(textB))) {
          if (!conflicting.includes(claims[i])) conflicting.push(claims[i]);
          if (!conflicting.includes(claims[j])) conflicting.push(claims[j]);
        }
      }

      // Numeric value conflicts
      const numsA = textA.match(/\b\d+(?:\.\d+)?/g) || [];
      const numsB = textB.match(/\b\d+(?:\.\d+)?/g) || [];
      if (numsA.length > 0 && numsB.length > 0) {
        const sim = topicSimilarity(
          textA.replace(/\d+/g, ''),
          textB.replace(/\d+/g, '')
        );
        if (sim > 0.5 && numsA[0] !== numsB[0]) {
          if (!conflicting.includes(claims[i])) conflicting.push(claims[i]);
          if (!conflicting.includes(claims[j])) conflicting.push(claims[j]);
        }
      }
    }
  }

  return conflicting;
}

function determineSeverity(claims: ConflictingClaim[]): Conflict['severity'] {
  const platforms = new Set(claims.map(c => c.platform));
  const avgConfidence = claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length;

  if (platforms.size > 2 && avgConfidence > 0.6) return 'high';
  if (platforms.size > 1 || avgConfidence > 0.5) return 'medium';
  return 'low';
}

function generateResolutionHint(topic: string, claims: ConflictingClaim[]): string {
  const platforms = [...new Set(claims.map(c => c.platform))];
  const highConfidence = claims.filter(c => c.confidence > 0.6);

  if (highConfidence.length === 1) {
    return `Higher confidence claim from ${highConfidence[0].platform}. Consider verifying others.`;
  }
  if (platforms.length > 1) {
    return `Cross-platform conflict on "${topic}". Seek authoritative source for resolution.`;
  }
  return `Multiple conflicting claims. Manual verification recommended.`;
}

function computeSourceReliability(items: ContentItem[], conflicts: Conflict[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const item of items) {
    scores.set(item.source_url, 0.5);
  }

  // Penalize sources involved in conflicts
  for (const conflict of conflicts) {
    const penalty = conflict.severity === 'high' ? 0.15 : conflict.severity === 'medium' ? 0.1 : 0.05;
    for (const claim of conflict.claims) {
      const current = scores.get(claim.source_url) || 0.5;
      scores.set(claim.source_url, Math.max(0.1, current - penalty));
    }
  }

  return scores;
}

function severityOrder(s: Conflict['severity']): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}
