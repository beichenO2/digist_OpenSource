import cron from 'node-cron';
import { Storage } from '../storage/index.js';
import { firecrawlSearchScraper, isFirecrawlConfigured } from '../scrapers/firecrawl-scraper.js';
import { collect } from '../collector/layered-collector.js';
import { getStrategy } from '../collector/registry.js';
import { canScrapePlatformNow } from './risk-window-policy.js';
import { normalizeBatch, deduplicateByUrl } from '../normalizer/index.js';
import type { ScrapeJob } from '../types/index.js';

// Heavy platform gets a smaller per-run cap. Only zhihu uses the L3 anti-detect
// browser now; bloomberg moved to CNBC RSS (L1), bilibili to L1 open API,
// twitter/xiaohongshu removed.
const HEAVY_PLATFORMS = new Set(['zhihu']);

export class Scheduler {
  private storage: Storage;
  private tasks = new Map<string, cron.ScheduledTask>();

  constructor(storage: Storage) {
    this.storage = storage;
  }

  addJob(platform: string, query: string, cronExpr: string): ScrapeJob {
    if (!cron.validate(cronExpr)) {
      throw new Error(`Invalid cron expression: ${cronExpr}`);
    }

    const job = this.storage.createJob({
      platform: platform as ScrapeJob['platform'],
      query,
      cron_expression: cronExpr,
      enabled: true,
    });

    this.scheduleJob(job);
    return job;
  }

  removeJob(jobId: string): void {
    const task = this.tasks.get(jobId);
    if (task) {
      task.stop();
      this.tasks.delete(jobId);
    }
    this.storage.deleteJob(jobId);
  }

  startAll(): void {
    const jobs = this.storage.listJobs(true);
    for (const job of jobs) {
      this.scheduleJob(job);
    }
    console.log(`[Scheduler] Started ${jobs.length} jobs`);
  }

  stopAll(): void {
    for (const [id, task] of this.tasks) {
      task.stop();
    }
    this.tasks.clear();
    console.log('[Scheduler] All jobs stopped');
  }

  listJobs(): ScrapeJob[] {
    return this.storage.listJobs();
  }

  async runJobNow(jobId: string): Promise<number> {
    const job = this.storage.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return this.executeJob(job);
  }

  private scheduleJob(job: ScrapeJob): void {
    if (this.tasks.has(job.id)) {
      this.tasks.get(job.id)!.stop();
    }

    const task = cron.schedule(job.cron_expression, async () => {
      try {
        const count = await this.executeJob(job);
        console.log(`[Scheduler] Job ${job.id} (${job.platform}:${job.query}): scraped ${count} items`);
      } catch (err) {
        console.error(`[Scheduler] Job ${job.id} failed:`, err);
      }
    });

    this.tasks.set(job.id, task);
  }

  private async executeJob(job: ScrapeJob): Promise<number> {
    if (!getStrategy(job.platform)) {
      console.error(`[Scheduler] No scraper for platform: ${job.platform}`);
      return 0;
    }

    const policy = canScrapePlatformNow(job.platform);
    if (!policy.allowed) {
      console.log(`[Scheduler] Skipped ${job.platform}: ${policy.reason}`);
      return 0;
    }

    const cursor = this.storage.getCursor(job.id, 'last_page');
    const maxItems = HEAVY_PLATFORMS.has(job.platform) ? 10 : 20;

    let result;
    try {
      // Route through the LayeredCollector (single source of platform → layer
      // truth) instead of a duplicate scraper map.
      result = await collect(job.platform, job.query, { cursor, maxItems });
    } catch (err) {
      console.warn(`[Scheduler] Primary scraper failed for ${job.platform}, trying Firecrawl fallback...`);
      if (isFirecrawlConfigured()) {
        result = await firecrawlSearchScraper.scrape(
          `${job.query} site:${job.platform}`,
          { maxItems },
        );
      } else {
        throw err;
      }
    }

    const normalized = normalizeBatch(result.items);
    const unique = deduplicateByUrl(normalized);
    const saved = this.storage.insertBatch(unique);

    if (result.next_cursor) {
      this.storage.setCursor(job.id, 'last_page', result.next_cursor);
      this.storage.updateJobCursor(job.id, result.next_cursor);
    }

    return saved.length;
  }
}
