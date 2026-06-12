import { Storage } from '../storage/index.js';
import { evaluateDensity } from '../digestion/density-evaluator.js';
import type { ContentItem, ScrapeJob } from '../types/index.js';

export interface OptimizationResult {
  job_id: string;
  platform: string;
  query: string;
  current_score: number;
  recommended_actions: RecommendedAction[];
  applied: boolean;
}

interface RecommendedAction {
  type: 'adjust_frequency' | 'modify_query' | 'disable_job' | 'boost_priority';
  description: string;
  expected_impact: number;
}

export interface StrategyMetrics {
  job_id: string;
  total_scraped: number;
  unique_after_dedup: number;
  avg_density: number;
  high_value_ratio: number;
  last_successful_scrape: string | null;
  dedup_waste_ratio: number;
}

export class StrategyOptimizer {
  private storage: Storage;
  private metricsHistory = new Map<string, StrategyMetrics[]>();

  constructor(storage: Storage) {
    this.storage = storage;
  }

  evaluateJob(job: ScrapeJob): StrategyMetrics {
    const items = this.storage.listContent(job.platform, 1000)
      .filter(item => item.tags.some(t => t.includes(job.query.toLowerCase())));

    const densities = items.map(item => evaluateDensity(item).overall);
    const avgDensity = densities.length > 0
      ? densities.reduce((a, b) => a + b, 0) / densities.length
      : 0;

    const highValueCount = densities.filter(d => d > 0.5).length;
    const allContent = this.storage.listContent(job.platform, 10000);
    const dedupWaste = allContent.length > 0
      ? 1 - (items.length / Math.max(allContent.length, 1))
      : 0;

    return {
      job_id: job.id,
      total_scraped: allContent.length,
      unique_after_dedup: items.length,
      avg_density: avgDensity,
      high_value_ratio: items.length > 0 ? highValueCount / items.length : 0,
      last_successful_scrape: job.last_run_at,
      dedup_waste_ratio: dedupWaste,
    };
  }

  optimize(job: ScrapeJob): OptimizationResult {
    const metrics = this.evaluateJob(job);
    const actions: RecommendedAction[] = [];

    // Track history
    const history = this.metricsHistory.get(job.id) || [];
    history.push(metrics);
    if (history.length > 20) history.shift();
    this.metricsHistory.set(job.id, history);

    // Low density content — reduce frequency
    if (metrics.avg_density < 0.2 && metrics.total_scraped > 10) {
      actions.push({
        type: 'adjust_frequency',
        description: `Low avg density (${metrics.avg_density.toFixed(2)}). Reduce scraping frequency.`,
        expected_impact: 0.3,
      });
    }

    // High dedup waste — modify query
    if (metrics.dedup_waste_ratio > 0.7) {
      actions.push({
        type: 'modify_query',
        description: `High duplicate ratio (${(metrics.dedup_waste_ratio * 100).toFixed(0)}%). Refine search query.`,
        expected_impact: 0.4,
      });
    }

    // No high-value content — consider disabling
    if (metrics.high_value_ratio < 0.05 && metrics.total_scraped > 50) {
      actions.push({
        type: 'disable_job',
        description: `Very low value ratio (${(metrics.high_value_ratio * 100).toFixed(1)}%). Consider disabling.`,
        expected_impact: 0.2,
      });
    }

    // High density — boost priority
    if (metrics.avg_density > 0.6) {
      actions.push({
        type: 'boost_priority',
        description: `High quality source (avg density ${metrics.avg_density.toFixed(2)}). Increase frequency.`,
        expected_impact: 0.5,
      });
    }

    // Trend analysis
    if (history.length >= 3) {
      const recent = history.slice(-3);
      const trend = recent[2].avg_density - recent[0].avg_density;
      if (trend < -0.1) {
        actions.push({
          type: 'modify_query',
          description: `Quality declining (trend: ${trend.toFixed(2)}). Consider refreshing search terms.`,
          expected_impact: 0.3,
        });
      }
    }

    return {
      job_id: job.id,
      platform: job.platform,
      query: job.query,
      current_score: metrics.avg_density,
      recommended_actions: actions,
      applied: false,
    };
  }

  optimizeAll(): OptimizationResult[] {
    const jobs = this.storage.listJobs();
    return jobs.map(job => this.optimize(job));
  }

  applyRecommendation(result: OptimizationResult, actionIndex: number): void {
    const action = result.recommended_actions[actionIndex];
    if (!action) return;

    const job = this.storage.getJob(result.job_id);
    if (!job) return;

    switch (action.type) {
      case 'adjust_frequency': {
        // Double the interval
        const parts = job.cron_expression.split(' ');
        if (parts[0].startsWith('*/')) {
          const current = parseInt(parts[0].replace('*/', ''));
          parts[0] = `*/${Math.min(current * 2, 60)}`;
        }
        // Note: would need to recreate job with new cron
        break;
      }
      case 'disable_job':
        this.storage.toggleJob(job.id, false);
        break;
      case 'boost_priority': {
        // Halve the interval
        const parts = job.cron_expression.split(' ');
        if (parts[0].startsWith('*/')) {
          const current = parseInt(parts[0].replace('*/', ''));
          parts[0] = `*/${Math.max(Math.floor(current / 2), 5)}`;
        }
        break;
      }
    }

    result.applied = true;
  }
}
