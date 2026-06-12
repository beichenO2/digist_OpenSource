import { Storage } from './storage/index.js';
import { Scheduler } from './scheduler/index.js';
import { SmartScheduler } from './scheduler/smart-scheduler.js';
import { KnowledgeGraph } from './fusion/knowledge-graph.js';
import { KnowledgeIndex } from './digestion/knowledge-index.js';
import { StrategyOptimizer } from './evolution/strategy-optimizer.js';
import { SourceDiscoverer } from './evolution/source-discoverer.js';
import { PipelineTuner } from './evolution/pipeline-tuner.js';
import { EvolutionLog } from './evolution/evolution-log.js';
import { evaluateDensity, filterByDensity } from './digestion/density-evaluator.js';
import { generateFusionReport } from './fusion/report-generator.js';
import { compressBatchWithLLM } from './digestion/context-compressor.js';
import { researchGaps } from './research/deep-researcher.js';
import { mkdirSync, writeFileSync } from 'fs';
import { emitBug, emitDigistReport } from './adapters/polarclaw/index.js';

export interface EngineConfig {
  dbPath: string;
  evolutionLogDir: string;
  reportDir: string;
  evolutionIntervalMs: number;
  reportIntervalMs: number;
  useSmartScheduler: boolean;
}

const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  dbPath: './data/digist.sqlite',
  evolutionLogDir: './data/evolution',
  reportDir: './data/reports',
  evolutionIntervalMs: 30 * 60 * 1000,
  reportIntervalMs: 60 * 60 * 1000,
  useSmartScheduler: process.env.DIGIST_SMART_SCHEDULER === '1',
};

export class DiGistEngine {
  private config: EngineConfig;
  private storage: Storage;
  private scheduler: Scheduler;
  private smartScheduler: SmartScheduler | null = null;
  private graph: KnowledgeGraph;
  private index: KnowledgeIndex;
  private optimizer: StrategyOptimizer;
  private discoverer: SourceDiscoverer;
  private tuner: PipelineTuner;
  private evoLog: EvolutionLog;
  private running = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };

    mkdirSync('./data', { recursive: true });
    mkdirSync(this.config.reportDir, { recursive: true });

    this.storage = new Storage(this.config.dbPath);
    this.scheduler = new Scheduler(this.storage);
    if (this.config.useSmartScheduler) {
      this.smartScheduler = new SmartScheduler(this.storage);
    }
    this.graph = new KnowledgeGraph();
    this.index = new KnowledgeIndex();
    this.optimizer = new StrategyOptimizer(this.storage);
    this.discoverer = new SourceDiscoverer(this.graph, this.index);
    this.tuner = new PipelineTuner();
    this.evoLog = new EvolutionLog(this.config.evolutionLogDir);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('='.repeat(55));
    console.log('DiGist — AI Self-Evolution Information Digestion Engine');
    console.log('='.repeat(55));

    // Bootstrap: index existing content
    const existing = this.storage.listContent(undefined, 10000);
    if (existing.length > 0) {
      console.log(`[Engine] Indexing ${existing.length} existing items...`);
      this.graph.addBatch(existing);
      this.index.ingestBatch(existing);
    }

    if (this.smartScheduler) {
      this.smartScheduler.start();
      console.log('[Engine] SmartScheduler enabled (yield-based throttling)');
    } else {
      this.scheduler.startAll();
    }

    // Start evolution cycle
    this.timers.push(
      setInterval(() => this.evolutionCycle(), this.config.evolutionIntervalMs)
    );

    // Start report generation
    this.timers.push(
      setInterval(() => this.generatePeriodicReport(), this.config.reportIntervalMs)
    );

    // Run first evolution immediately
    setTimeout(() => this.evolutionCycle(), 5000);

    this.printStatus();
    console.log('[Engine] Running. Press Ctrl+C to stop.');

    this.evoLog.recordMilestone('Engine started', {
      existing_items: existing.length,
      jobs: this.scheduler.listJobs().length,
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.log('[Engine] Shutting down...');

    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];

    if (this.smartScheduler) {
      this.smartScheduler.stop();
    } else {
      this.scheduler.stopAll();
    }
    this.storage.close();

    this.evoLog.recordMilestone('Engine stopped', {
      total_items: this.storage.contentCount?.() || 0,
    });

    console.log('[Engine] Stopped.');
  }

  private async evolutionCycle(): Promise<void> {
    console.log('[Evolution] Starting cycle...');

    try {
      // 1. Index new content
      const recentItems = this.storage.listContent(undefined, 100);
      const newItems = recentItems.filter(item => {
        const existing = this.index.search(item.source_url, 1);
        return existing.length === 0 || existing[0].score < 0.95;
      });

      if (newItems.length > 0) {
        this.graph.addBatch(newItems);
        this.index.ingestBatch(newItems);
        console.log(`[Evolution] Indexed ${newItems.length} new items`);
      }

      // 2. Optimize strategies
      const optimizations = this.optimizer.optimizeAll();
      for (const opt of optimizations) {
        if (opt.recommended_actions.length > 0) {
          const action = opt.recommended_actions[0];
          console.log(`[Evolution] ${opt.platform}:${opt.query} — ${action.description}`);
          this.evoLog.recordStrategyChange(
            opt.job_id,
            { score: opt.current_score },
            { action: action.type },
            action.description,
          );
        }
      }

      // 3. Discover new sources
      const allItems = this.storage.listContent(undefined, 1000);
      const discoveries = this.discoverer.discoverNewSources(allItems);
      for (const disc of discoveries.slice(0, 3)) {
        console.log(`[Evolution] New source suggestion: ${disc.platform} — "${disc.query}" (${disc.reason})`);
        this.evoLog.recordSourceDiscovery(disc.platform, disc.query, disc.reason);

        // Auto-add high-confidence discoveries as jobs
        if (disc.confidence > 0.7) {
          try {
            this.scheduler.addJob(disc.platform, disc.query, '0 */4 * * *'); // every 4h
            console.log(`[Evolution] Auto-added job: ${disc.platform}:${disc.query}`);
          } catch (err) {
            console.error(`[Evolution] Failed to add job:`, err);
          }
        }
      }

      // 4. LLM-enhanced compression for new items
      if (newItems.length > 0) {
        try {
          const digests = await compressBatchWithLLM(newItems.slice(0, 10));
          const llmCount = digests.filter(d => d.compression_ratio < 0.5).length;
          if (llmCount > 0) {
            console.log(`[Evolution] LLM-compressed ${llmCount}/${digests.length} items`);
          }
        } catch (err) {
          console.warn(`[Evolution] LLM compression skipped: ${err}`);
        }
      }

      // 5. Deep research — fill knowledge gaps via Firecrawl + LLM
      try {
        const gaps = this.graph.detectKnowledgeGaps(3);
        if (gaps.length > 0) {
          console.log(`[Evolution] Found ${gaps.length} knowledge gaps, launching deep research...`);
          const researchResults = await researchGaps(gaps);
          for (const r of researchResults) {
            if (r.findings.length > 0) {
              this.graph.addBatch(r.findings);
              this.index.ingestBatch(r.findings);
              console.log(`[Evolution] Deep research filled gap "${r.gap.title}" with ${r.findings.length} sources (${r.iterations} iterations, coverage: ${(r.reflection.coverage_score * 100).toFixed(0)}%)`);
              this.evoLog.recordMilestone(`Deep research: ${r.gap.title}`, {
                findings: r.findings.length,
                iterations: r.iterations,
                coverage: r.reflection.coverage_score,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[Evolution] Deep research skipped: ${err}`);
      }

      // 6. Tune pipeline
      const tuningResults = this.tuner.tune(recentItems);
      for (const result of tuningResults) {
        console.log(`[Evolution] Pipeline: ${result.parameter} ${result.current_value} → ${result.suggested_value} (${result.reason})`);
        this.evoLog.recordPipelineTuning(
          result.parameter,
          result.current_value,
          result.suggested_value,
          result.reason,
        );
      }

      if (tuningResults.length > 0) {
        this.tuner.applyTuning(tuningResults);
      }

      console.log('[Evolution] Cycle complete.');
    } catch (err) {
      console.error('[Evolution] Cycle error:', err);
      emitBug(err, { component: 'engine', operation: 'evolution_cycle' }).catch(() => {});
    }
  }

  private generatePeriodicReport(): void {
    try {
      const items = this.storage.listContent(undefined, 500);
      if (items.length === 0) return;

      const report = generateFusionReport(items);
      const filename = `report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
      const filepath = `${this.config.reportDir}/${filename}`;

      writeFileSync(filepath, report.full_markdown);
      console.log(`[Report] Generated: ${filepath}`);

      this.evoLog.recordMilestone(`Report generated: ${filename}`, {
        sources: report.sources.length,
        insights: report.key_insights.length,
        conflicts: report.conflicts_summary.length,
      });

      emitDigistReport({
        title: report.title,
        path: filepath,
        sources_count: report.sources.length,
        insights_count: report.key_insights.length,
      }).catch(() => {});
    } catch (err) {
      console.error('[Report] Generation error:', err);
      emitBug(err, { component: 'engine', operation: 'periodic_report' }).catch(() => {});
    }
  }

  printStatus(): void {
    const graphStats = this.graph.getStats();
    const indexStats = this.index.getStats();

    console.log('\n--- DiGist Status ---');
    console.log(`Content: ${this.storage.contentCount()} items`);
    console.log(`Jobs: ${this.scheduler.listJobs().length} scheduled`);
    console.log(`Graph: ${graphStats.nodes} nodes, ${graphStats.edges} edges`);
    console.log(`Index: ${indexStats.total_fragments} fragments`);
    console.log(`Evolution: ${this.evoLog.getHistory().length} entries`);
    console.log('--------------------\n');
  }
}
