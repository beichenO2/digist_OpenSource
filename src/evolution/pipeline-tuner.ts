import type { ContentItem } from '../types/index.js';
import { evaluateDensity, type DensityReport } from '../digestion/density-evaluator.js';
import { compressContent } from '../digestion/context-compressor.js';

export interface PipelineConfig {
  density_threshold: number;
  compression_target_ratio: number;
  max_items_per_scrape: number;
  dedup_window_size: number;
  min_content_length: number;
  max_content_length: number;
  cross_validation_min_sources: number;
}

export interface TuningResult {
  parameter: keyof PipelineConfig;
  current_value: number;
  suggested_value: number;
  reason: string;
  impact_estimate: 'high' | 'medium' | 'low';
}

const DEFAULT_CONFIG: PipelineConfig = {
  density_threshold: 0.3,
  compression_target_ratio: 0.3,
  max_items_per_scrape: 50,
  dedup_window_size: 1000,
  min_content_length: 50,
  max_content_length: 50000,
  cross_validation_min_sources: 2,
};

export class PipelineTuner {
  private config: PipelineConfig;
  private history: Array<{ config: PipelineConfig; metrics: PipelineMetrics; timestamp: string }> = [];

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getConfig(): PipelineConfig {
    return { ...this.config };
  }

  tune(recentItems: ContentItem[]): TuningResult[] {
    const results: TuningResult[] = [];
    const metrics = this.computeMetrics(recentItems);

    // Record for trend analysis
    this.history.push({
      config: { ...this.config },
      metrics,
      timestamp: new Date().toISOString(),
    });
    if (this.history.length > 50) this.history.shift();

    // Tune density threshold
    if (metrics.avg_density < 0.2 && this.config.density_threshold < 0.5) {
      results.push({
        parameter: 'density_threshold',
        current_value: this.config.density_threshold,
        suggested_value: Math.min(this.config.density_threshold + 0.1, 0.6),
        reason: `Average density too low (${metrics.avg_density.toFixed(2)}). Raise threshold to filter noise.`,
        impact_estimate: 'high',
      });
    } else if (metrics.avg_density > 0.7 && metrics.filtered_ratio > 0.5) {
      results.push({
        parameter: 'density_threshold',
        current_value: this.config.density_threshold,
        suggested_value: Math.max(this.config.density_threshold - 0.05, 0.1),
        reason: `Over-filtering (${(metrics.filtered_ratio * 100).toFixed(0)}% discarded). Lower threshold.`,
        impact_estimate: 'medium',
      });
    }

    // Tune compression ratio
    if (metrics.avg_compression_ratio > 0.5) {
      results.push({
        parameter: 'compression_target_ratio',
        current_value: this.config.compression_target_ratio,
        suggested_value: Math.max(this.config.compression_target_ratio - 0.05, 0.15),
        reason: `Compression not aggressive enough (${(metrics.avg_compression_ratio * 100).toFixed(0)}%). Tighten.`,
        impact_estimate: 'medium',
      });
    }

    // Tune batch size
    if (metrics.dedup_ratio > 0.5) {
      results.push({
        parameter: 'max_items_per_scrape',
        current_value: this.config.max_items_per_scrape,
        suggested_value: Math.max(Math.floor(this.config.max_items_per_scrape * 0.7), 10),
        reason: `High dedup ratio (${(metrics.dedup_ratio * 100).toFixed(0)}%). Reduce batch size.`,
        impact_estimate: 'low',
      });
    }

    // Tune content length bounds
    if (metrics.too_short_ratio > 0.3) {
      results.push({
        parameter: 'min_content_length',
        current_value: this.config.min_content_length,
        suggested_value: this.config.min_content_length + 50,
        reason: `${(metrics.too_short_ratio * 100).toFixed(0)}% items too short. Raise minimum.`,
        impact_estimate: 'low',
      });
    }

    // Trend-based tuning
    if (this.history.length >= 5) {
      const recent5 = this.history.slice(-5);
      const densityTrend = recent5[4].metrics.avg_density - recent5[0].metrics.avg_density;

      if (densityTrend < -0.15) {
        results.push({
          parameter: 'density_threshold',
          current_value: this.config.density_threshold,
          suggested_value: this.config.density_threshold + 0.15,
          reason: `Quality declining rapidly (trend: ${densityTrend.toFixed(2)}). Emergency threshold raise.`,
          impact_estimate: 'high',
        });
      }
    }

    return results;
  }

  applyTuning(results: TuningResult[]): PipelineConfig {
    for (const result of results) {
      (this.config as any)[result.parameter] = result.suggested_value;
    }
    return { ...this.config };
  }

  private computeMetrics(items: ContentItem[]): PipelineMetrics {
    if (items.length === 0) {
      return {
        avg_density: 0,
        density_std: 0,
        filtered_ratio: 0,
        avg_compression_ratio: 0,
        dedup_ratio: 0,
        too_short_ratio: 0,
        too_long_ratio: 0,
        items_processed: 0,
      };
    }

    const densities = items.map(item => evaluateDensity(item).overall);
    const avgDensity = densities.reduce((a, b) => a + b, 0) / densities.length;
    const variance = densities.reduce((sum, d) => sum + Math.pow(d - avgDensity, 2), 0) / densities.length;
    const std = Math.sqrt(variance);

    const filtered = densities.filter(d => d < this.config.density_threshold).length;
    const filteredRatio = filtered / items.length;

    const compressions = items.map(item => {
      const digest = compressContent(item);
      return digest.compression_ratio;
    });
    const avgCompression = compressions.reduce((a, b) => a + b, 0) / compressions.length;

    const urls = items.map(i => i.source_url);
    const uniqueUrls = new Set(urls);
    const dedupRatio = 1 - uniqueUrls.size / urls.length;

    const tooShort = items.filter(i => i.body_markdown.length < this.config.min_content_length).length;
    const tooLong = items.filter(i => i.body_markdown.length > this.config.max_content_length).length;

    return {
      avg_density: avgDensity,
      density_std: std,
      filtered_ratio: filteredRatio,
      avg_compression_ratio: avgCompression,
      dedup_ratio: dedupRatio,
      too_short_ratio: tooShort / items.length,
      too_long_ratio: tooLong / items.length,
      items_processed: items.length,
    };
  }
}

interface PipelineMetrics {
  avg_density: number;
  density_std: number;
  filtered_ratio: number;
  avg_compression_ratio: number;
  dedup_ratio: number;
  too_short_ratio: number;
  too_long_ratio: number;
  items_processed: number;
}
