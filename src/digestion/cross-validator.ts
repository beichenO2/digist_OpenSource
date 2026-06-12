import type { ContentItem } from '../types/index.js';
import { compressContent, type CompressedDigest, type Claim } from './context-compressor.js';

export interface ValidationResult {
  claim: Claim;
  source: string;
  corroborating_sources: CorroboratingSource[];
  contradicting_sources: ContradictingSource[];
  confidence: number;
  verdict: 'corroborated' | 'contradicted' | 'unique' | 'uncertain';
}

interface CorroboratingSource {
  source_url: string;
  platform: string;
  matching_text: string;
  similarity: number;
}

interface ContradictingSource {
  source_url: string;
  platform: string;
  contradicting_text: string;
  contradiction_type: 'negation' | 'different_value' | 'opposite_claim';
}

export interface CrossValidationReport {
  total_claims: number;
  corroborated: number;
  contradicted: number;
  unique: number;
  uncertain: number;
  results: ValidationResult[];
  cross_platform_insights: string[];
}

export function crossValidate(items: ContentItem[]): CrossValidationReport {
  const digests = items.map(item => ({
    item,
    digest: compressContent(item),
  }));

  const allResults: ValidationResult[] = [];

  for (let i = 0; i < digests.length; i++) {
    const { item: sourceItem, digest } = digests[i];
    const otherDigests = digests.filter((_, j) => j !== i);

    for (const claim of digest.claims) {
      const result = validateClaim(claim, sourceItem, otherDigests);
      allResults.push(result);
    }
  }

  const corroborated = allResults.filter(r => r.verdict === 'corroborated').length;
  const contradicted = allResults.filter(r => r.verdict === 'contradicted').length;
  const unique = allResults.filter(r => r.verdict === 'unique').length;
  const uncertain = allResults.filter(r => r.verdict === 'uncertain').length;

  const insights = generateCrossPlatformInsights(digests);

  return {
    total_claims: allResults.length,
    corroborated,
    contradicted,
    unique,
    uncertain,
    results: allResults.sort((a, b) => b.confidence - a.confidence),
    cross_platform_insights: insights,
  };
}

function validateClaim(
  claim: Claim,
  sourceItem: ContentItem,
  others: Array<{ item: ContentItem; digest: CompressedDigest }>,
): ValidationResult {
  const corroborating: CorroboratingSource[] = [];
  const contradicting: ContradictingSource[] = [];

  const claimWords = new Set(
    claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );

  for (const { item: otherItem, digest: otherDigest } of others) {
    // Check for corroboration
    for (const otherClaim of otherDigest.claims) {
      const sim = jaccardSimilarity(claim.text, otherClaim.text);
      if (sim > 0.3) {
        corroborating.push({
          source_url: otherItem.source_url,
          platform: otherItem.platform,
          matching_text: otherClaim.text,
          similarity: sim,
        });
      }
    }

    // Check for contradiction via negation patterns
    for (const otherClaim of otherDigest.claims) {
      if (isContradiction(claim.text, otherClaim.text)) {
        contradicting.push({
          source_url: otherItem.source_url,
          platform: otherItem.platform,
          contradicting_text: otherClaim.text,
          contradiction_type: detectContradictionType(claim.text, otherClaim.text),
        });
      }
    }

    // Also check body text for keyword overlap
    const bodyWords = new Set(
      otherItem.body_markdown.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );
    let overlap = 0;
    for (const w of claimWords) {
      if (bodyWords.has(w)) overlap++;
    }
    const bodyOverlap = overlap / Math.max(claimWords.size, 1);
    if (bodyOverlap > 0.4 && corroborating.length === 0) {
      corroborating.push({
        source_url: otherItem.source_url,
        platform: otherItem.platform,
        matching_text: `[Body text overlap: ${(bodyOverlap * 100).toFixed(0)}%]`,
        similarity: bodyOverlap,
      });
    }
  }

  let verdict: ValidationResult['verdict'];
  let confidence: number;

  if (contradicting.length > 0 && corroborating.length === 0) {
    verdict = 'contradicted';
    confidence = 0.3;
  } else if (corroborating.length >= 2) {
    verdict = 'corroborated';
    confidence = Math.min(0.5 + corroborating.length * 0.15, 0.95);
  } else if (corroborating.length === 1 && contradicting.length === 0) {
    verdict = 'corroborated';
    confidence = 0.6;
  } else if (corroborating.length === 0 && contradicting.length === 0) {
    verdict = 'unique';
    confidence = claim.confidence;
  } else {
    verdict = 'uncertain';
    confidence = 0.4;
  }

  // Cross-platform boost
  const platforms = new Set(corroborating.map(c => c.platform));
  if (platforms.size > 1) {
    confidence = Math.min(confidence + 0.1, 0.95);
  }

  return {
    claim,
    source: sourceItem.source_url,
    corroborating_sources: corroborating,
    contradicting_sources: contradicting,
    confidence,
    verdict,
  };
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isContradiction(claimA: string, claimB: string): boolean {
  const a = claimA.toLowerCase();
  const b = claimB.toLowerCase();

  // Direct negation patterns
  const negationPairs = [
    [/\bis\b/, /\bis not\b/],
    [/\bcan\b/, /\bcannot\b/],
    [/\bwill\b/, /\bwill not\b/],
    [/\bsupports?\b/, /\bdoes not support\b/],
    [/\benables?\b/, /\bdisables?\b/],
    [/\bfast\b/, /\bslow\b/],
    [/\bsecure\b/, /\binsecure\b/],
    [/\bbetter\b/, /\bworse\b/],
    [/\bincrease\b/, /\bdecrease\b/],
  ];

  const sim = jaccardSimilarity(claimA, claimB);
  if (sim < 0.2) return false; // too different to contradict

  for (const [patA, patB] of negationPairs) {
    if ((patA.test(a) && patB.test(b)) || (patB.test(a) && patA.test(b))) {
      return true;
    }
  }

  return false;
}

function detectContradictionType(a: string, b: string): ContradictingSource['contradiction_type'] {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();

  if (/\bnot\b/.test(al) !== /\bnot\b/.test(bl)) return 'negation';

  const numbersA = a.match(/\d+/g) || [];
  const numbersB = b.match(/\d+/g) || [];
  if (numbersA.length > 0 && numbersB.length > 0 && numbersA[0] !== numbersB[0]) {
    return 'different_value';
  }

  return 'opposite_claim';
}

function generateCrossPlatformInsights(
  digests: Array<{ item: ContentItem; digest: CompressedDigest }>,
): string[] {
  const insights: string[] = [];

  // Platform distribution
  const platformCounts = new Map<string, number>();
  for (const { item } of digests) {
    platformCounts.set(item.platform, (platformCounts.get(item.platform) || 0) + 1);
  }

  if (platformCounts.size > 1) {
    const platforms = [...platformCounts.entries()]
      .map(([p, c]) => `${p}(${c})`)
      .join(', ');
    insights.push(`Cross-platform coverage: ${platforms}`);
  }

  // Shared key phrases across platforms
  const phrasesByPlatform = new Map<string, Set<string>>();
  for (const { item, digest } of digests) {
    if (!phrasesByPlatform.has(item.platform)) {
      phrasesByPlatform.set(item.platform, new Set());
    }
    for (const phrase of digest.key_phrases) {
      phrasesByPlatform.get(item.platform)!.add(phrase);
    }
  }

  if (phrasesByPlatform.size > 1) {
    const allPlatformPhrases = [...phrasesByPlatform.values()];
    const shared = [...allPlatformPhrases[0]].filter(phrase =>
      allPlatformPhrases.every(set => set.has(phrase))
    );
    if (shared.length > 0) {
      insights.push(`Shared topics across platforms: ${shared.slice(0, 5).join(', ')}`);
    }
  }

  // Unique insights per platform
  for (const [platform, phrases] of phrasesByPlatform) {
    const uniquePhrases = [...phrases].filter(phrase => {
      for (const [otherPlatform, otherPhrases] of phrasesByPlatform) {
        if (otherPlatform !== platform && otherPhrases.has(phrase)) return false;
      }
      return true;
    });
    if (uniquePhrases.length > 0) {
      insights.push(`Unique to ${platform}: ${uniquePhrases.slice(0, 3).join(', ')}`);
    }
  }

  return insights;
}
