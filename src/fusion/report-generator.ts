import type { ContentItem } from '../types/index.js';
import { evaluateDensity } from '../digestion/density-evaluator.js';
import { compressBatch } from '../digestion/context-compressor.js';
import { crossValidate } from '../digestion/cross-validator.js';
import { discoverLinks } from './semantic-linker.js';
import { detectConflicts } from './conflict-detector.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { ingestBatchToRaw } from '../wiki/raw-ingester.js';
import { compile as compileWikiLocal, compileReport as saveReport } from '../wiki/wiki-compiler.js';
import { emitDigistReport } from '../adapters/polarclaw/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const execAsync = promisify(execFile);

export interface FusionReport {
  title: string;
  generated_at: string;
  sources: SourceSummary[];
  executive_summary: string;
  key_insights: string[];
  topic_clusters: TopicCluster[];
  cross_platform_analysis: string[];
  conflicts_summary: string[];
  knowledge_gaps: string[];
  recommendations: string[];
  full_markdown: string;
}

interface SourceSummary {
  platform: string;
  url: string;
  title: string;
  density_score: number;
}

interface TopicCluster {
  name: string;
  sources: string[];
  key_facts: string[];
}

export function generateFusionReport(items: ContentItem[], topic?: string): FusionReport {
  const now = new Date().toISOString();
  const title = topic
    ? `Fusion Report: ${topic}`
    : `Multi-Source Intelligence Report — ${new Date().toLocaleDateString()}`;

  // Analyze sources
  const sources: SourceSummary[] = items.map(item => ({
    platform: item.platform,
    url: item.source_url,
    title: item.title,
    density_score: evaluateDensity(item).overall,
  }));

  // Compress all content
  const digests = compressBatch(items);

  // Cross-validate
  const validation = crossValidate(items);

  // Discover links
  const links = discoverLinks(items);

  // Detect conflicts
  const conflicts = detectConflicts(items);

  // Build knowledge graph
  const graph = new KnowledgeGraph();
  graph.addBatch(items);

  // Generate insights
  const insights = generateKeyInsights(items, digests, validation, links, graph);
  const topicClusters = generateTopicClusters(items, graph);
  const crossPlatform = generateCrossPlatformAnalysis(items, links, graph);
  const conflictsSummary = summarizeConflicts(conflicts);

  const structuredGaps = graph.detectKnowledgeGaps();
  const gaps = structuredGaps.map(g => `[${g.type}] ${g.title}: ${g.description} — ${g.suggestion}`);

  const surprisingConnections = graph.findSurprisingConnections();
  if (surprisingConnections.length > 0) {
    insights.push(`${surprisingConnections.length} surprising connections found`);
    for (const conn of surprisingConnections.slice(0, 3)) {
      insights.push(`[Surprising] ${conn.source.label} ↔ ${conn.target.label}: ${conn.reasons.join(', ')}`);
    }
  }

  const communityInfo = graph.getCommunityInfo();
  if (communityInfo.length > 0) {
    insights.push(`Louvain detected ${communityInfo.length} knowledge communities`);
  }

  const recommendations = generateRecommendations(items, insights, gaps);

  const execSummary = buildExecutiveSummary(items, insights, crossPlatform, conflictsSummary);
  const fullMarkdown = buildFullReport(title, now, sources, execSummary, insights, topicClusters, crossPlatform, conflictsSummary, gaps, recommendations);

  const densityScores = items.map(item => evaluateDensity(item).overall);
  try {
    ingestBatchToRaw(items, digests, densityScores);
    triggerWikiCompilation().catch(() => {});
    saveReport(fullMarkdown, topic || 'multi-source').catch(() => {});
  } catch { /* wiki ingestion is non-blocking */ }

  const targetProject = inferTargetProject(items, topic);
  emitDigistReport(
    { title, topic, sources_count: sources.length, insights_count: insights.length },
    targetProject,
  ).catch(() => {});

  return {
    title,
    generated_at: now,
    sources,
    executive_summary: execSummary,
    key_insights: insights,
    topic_clusters: topicClusters,
    cross_platform_analysis: crossPlatform,
    conflicts_summary: conflictsSummary,
    knowledge_gaps: gaps,
    recommendations,
    full_markdown: fullMarkdown,
  };
}

/**
 * Best-effort inference of target project from report content.
 * Returns undefined if no clear single-project target can be determined.
 */
function inferTargetProject(items: ContentItem[], topic?: string): string | undefined {
  if (!topic) return undefined;
  const knownProjects = ['Clock', 'KnowLever', 'AutoOffice', 'tqsdk', 'PolarClaw', 'SOTAgent', 'PolarCopilot'];
  const lower = topic.toLowerCase();
  for (const p of knownProjects) {
    if (lower.includes(p.toLowerCase())) return p;
  }
  return undefined;
}

async function triggerWikiCompilation(): Promise<void> {
  const klCompile = resolve(process.cwd(), '..', 'KnowLever', 'wiki-engine', 'compile.js');
  if (existsSync(klCompile)) {
    try {
      await execAsync('node', [klCompile], {
        cwd: resolve(process.cwd(), '..', 'KnowLever'),
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return;
    } catch {
      // KnowLever compilation failed, fall back to local
    }
  }
  await compileWikiLocal();
}

function generateKeyInsights(
  items: ContentItem[],
  digests: ReturnType<typeof compressBatch>,
  validation: ReturnType<typeof crossValidate>,
  links: ReturnType<typeof discoverLinks>,
  graph: KnowledgeGraph,
): string[] {
  const insights: string[] = [];

  // High-confidence corroborated claims
  const corroborated = validation.results
    .filter(r => r.verdict === 'corroborated' && r.confidence > 0.7)
    .slice(0, 5);

  for (const r of corroborated) {
    insights.push(`[Verified] ${r.claim.text} (${r.corroborating_sources.length} sources corroborate)`);
  }

  // Hub entities from graph
  const hubs = graph.getHubs(5);
  if (hubs.length > 0) {
    insights.push(`Central entities: ${hubs.map(h => h.label).join(', ')}`);
  }

  // Bridging entities
  const bridges = graph.findBridgingEntities();
  if (bridges.length > 0) {
    insights.push(`Cross-domain connectors: ${bridges.slice(0, 3).map(b => b.label).join(', ')}`);
  }

  // Strong cross-platform links
  if (links.cross_platform_links > 0) {
    insights.push(`${links.cross_platform_links} cross-platform connections discovered`);
  }

  // High-density sources
  const highDensity = items
    .map(item => ({ item, density: evaluateDensity(item).overall }))
    .sort((a, b) => b.density - a.density)
    .slice(0, 3);

  for (const { item, density } of highDensity) {
    if (density > 0.6) {
      insights.push(`High-value source [${density.toFixed(2)}]: ${item.title.slice(0, 60)} (${item.platform})`);
    }
  }

  return insights;
}

function generateTopicClusters(items: ContentItem[], graph: KnowledgeGraph): TopicCluster[] {
  const clusters = graph.getClusters();
  const result: TopicCluster[] = [];

  for (const [clusterLabel, nodeIds] of clusters) {
    const sourceIds = nodeIds.filter(id => id.startsWith('source:'));
    const topicIds = nodeIds.filter(id => id.startsWith('topic:'));

    if (sourceIds.length < 2) continue;

    const clusterSources = sourceIds.map(id => {
      const item = items.find(i => `source:${i.id}` === id);
      return item?.source_url || id;
    });

    result.push({
      name: topicIds.length > 0
        ? topicIds.slice(0, 3).map(id => id.replace('topic:', '').replace(/_/g, ' ')).join(', ')
        : `Cluster ${result.length + 1}`,
      sources: clusterSources,
      key_facts: [],
    });
  }

  return result.slice(0, 10);
}

function generateCrossPlatformAnalysis(
  items: ContentItem[],
  links: ReturnType<typeof discoverLinks>,
  graph: KnowledgeGraph,
): string[] {
  const analysis: string[] = [];
  const platforms = [...new Set(items.map(i => i.platform))];

  if (platforms.length > 1) {
    analysis.push(`Analyzed ${items.length} items across ${platforms.length} platforms: ${platforms.join(', ')}`);
  }

  if (links.suggested_connections.length > 0) {
    analysis.push(...links.suggested_connections.slice(0, 5));
  }

  const bridging = graph.findBridgingEntities();
  if (bridging.length > 0) {
    analysis.push(`Key bridging entities connecting platforms: ${bridging.slice(0, 5).map(b => b.label).join(', ')}`);
  }

  return analysis;
}

function summarizeConflicts(report: ReturnType<typeof detectConflicts>): string[] {
  const summary: string[] = [];

  if (report.total_conflicts === 0) {
    summary.push('No significant conflicts detected across sources.');
    return summary;
  }

  summary.push(`${report.total_conflicts} conflicts detected:`);
  for (const conflict of report.conflicts.slice(0, 5)) {
    summary.push(`  [${conflict.severity.toUpperCase()}] ${conflict.topic}: ${conflict.resolution_hint}`);
  }

  if (report.consensus_items.length > 0) {
    summary.push(`${report.consensus_items.length} claims have cross-source consensus.`);
  }

  return summary;
}

function generateRecommendations(items: ContentItem[], insights: string[], gaps: string[]): string[] {
  const recs: string[] = [];

  const platforms = new Set(items.map(i => i.platform));
  const allPlatforms: ContentItem['platform'][] = ['twitter', 'reddit', 'wechat', 'github'];
  const missing = allPlatforms.filter(p => !platforms.has(p));

  if (missing.length > 0) {
    recs.push(`Expand coverage to: ${missing.join(', ')}`);
  }

  if (gaps.length > 0) {
    recs.push(`Address ${gaps.length} knowledge gaps identified`);
  }

  if (items.length < 10) {
    recs.push('Increase sample size for more reliable cross-validation');
  }

  recs.push('Schedule periodic re-scraping to track topic evolution');

  return recs;
}

function buildExecutiveSummary(
  items: ContentItem[],
  insights: string[],
  crossPlatform: string[],
  conflicts: string[],
): string {
  const platforms = [...new Set(items.map(i => i.platform))];
  const parts: string[] = [];

  parts.push(`Analyzed ${items.length} sources from ${platforms.length} platform(s).`);

  if (insights.length > 0) {
    parts.push(`Key findings: ${insights[0]}`);
  }

  if (crossPlatform.length > 0) {
    parts.push(crossPlatform[0]);
  }

  parts.push(conflicts[0] || 'No conflicts detected.');

  return parts.join(' ');
}

function buildFullReport(
  title: string, timestamp: string,
  sources: SourceSummary[], summary: string,
  insights: string[], clusters: TopicCluster[],
  crossPlatform: string[], conflicts: string[],
  gaps: string[], recommendations: string[],
): string {
  const lines: string[] = [];

  lines.push(`# ${title}\n`);
  lines.push(`*Generated: ${timestamp}*\n`);

  lines.push('## Executive Summary\n');
  lines.push(`${summary}\n`);

  lines.push('## Sources\n');
  for (const s of sources) {
    lines.push(`- [${s.platform}] ${s.title.slice(0, 60)} (density: ${s.density_score.toFixed(2)}) — ${s.url}`);
  }
  lines.push('');

  lines.push('## Key Insights\n');
  for (const insight of insights) {
    lines.push(`- ${insight}`);
  }
  lines.push('');

  if (clusters.length > 0) {
    lines.push('## Topic Clusters\n');
    for (const cluster of clusters) {
      lines.push(`### ${cluster.name}`);
      lines.push(`Sources: ${cluster.sources.length}`);
      lines.push('');
    }
  }

  if (crossPlatform.length > 0) {
    lines.push('## Cross-Platform Analysis\n');
    for (const item of crossPlatform) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  lines.push('## Conflicts & Consensus\n');
  for (const item of conflicts) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  if (gaps.length > 0) {
    lines.push('## Knowledge Gaps\n');
    for (const gap of gaps) {
      lines.push(`- ${gap}`);
    }
    lines.push('');
  }

  lines.push('## Recommendations\n');
  for (const rec of recommendations) {
    lines.push(`- ${rec}`);
  }

  return lines.join('\n');
}
