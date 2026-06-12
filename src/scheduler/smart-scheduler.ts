import { Storage } from '../storage/index.js';
import { Scheduler } from './index.js';
import { canScrapePlatformNow } from './risk-window-policy.js';

/**
 * Daily cap: 200 items per platform per day.
 *
 * Calculation:
 *   - 200 items / day, each scrape grabs ~15 items → ~13 scrapes / day
 *   - 24h / 13 ≈ 110 min between scrapes → baseIntervalMin ~120
 *   - Platforms with faster turnover (twitter, hackernews) get 90 min intervals
 *   - Slow platforms (github, bloomberg) get 180 min
 *   - Between each platform scrape: 30s stagger to avoid burst
 */

const DAILY_CAP_PER_PLATFORM = parseInt(process.env.DIGIST_DAILY_CAP || '200', 10);
const ITEMS_PER_SCRAPE = 15;
const STAGGER_MS = 30_000;

interface PlatformPolicy {
  intervalMin: number;
}

const POLICIES: Record<string, PlatformPolicy> = {
  twitter:      { intervalMin: 90 },
  hackernews:   { intervalMin: 90 },
  youtube:      { intervalMin: 120 },
  reddit:       { intervalMin: 120 },
  arxiv:        { intervalMin: 120 },
  bilibili:     { intervalMin: 120 },
  xiaohongshu:  { intervalMin: 120 },
  zhihu:        { intervalMin: 120 },
  bloomberg:    { intervalMin: 180 },
  github:       { intervalMin: 180 },
  wechat:       { intervalMin: 180 },
  glass:        { intervalMin: 15 },
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export class SmartScheduler {
  private storage: Storage;
  private scheduler: Scheduler;
  private lastRunAt = new Map<string, number>();
  private dailyCounts = new Map<string, { date: string; count: number }>();
  private running = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  onNewItems: ((totalNew: number) => void) | null = null;

  constructor(storage: Storage) {
    this.storage = storage;
    this.scheduler = new Scheduler(storage);
  }

  private getDailyCount(platform: string): number {
    const entry = this.dailyCounts.get(platform);
    if (!entry || entry.date !== todayKey()) return 0;
    return entry.count;
  }

  private addDailyCount(platform: string, n: number): void {
    const key = todayKey();
    const entry = this.dailyCounts.get(platform);
    if (!entry || entry.date !== key) {
      this.dailyCounts.set(platform, { date: key, count: n });
    } else {
      entry.count += n;
    }
  }

  private isOverCap(platform: string): boolean {
    return this.getDailyCount(platform) >= DAILY_CAP_PER_PLATFORM;
  }

  private shouldRunNow(platform: string): boolean {
    if (this.isOverCap(platform)) return false;
    if (!canScrapePlatformNow(platform).allowed) return false;

    const policy = POLICIES[platform] ?? { intervalMin: 120 };
    const last = this.lastRunAt.get(platform) ?? 0;
    const elapsedMin = (Date.now() - last) / 60_000;

    return elapsedMin >= policy.intervalMin;
  }

  async runOnce(): Promise<{ platform: string; newItems: number }[]> {
    const results: { platform: string; newItems: number }[] = [];
    const jobs = this.scheduler.listJobs();

    const eligible = jobs.filter(j => j.enabled && this.shouldRunNow(j.platform));

    eligible.sort((a, b) => (this.lastRunAt.get(a.platform) ?? 0) - (this.lastRunAt.get(b.platform) ?? 0));

    for (const job of eligible) {
      if (!this.running) break;

      const remaining = DAILY_CAP_PER_PLATFORM - this.getDailyCount(job.platform);
      if (remaining <= 0) continue;

      try {
        const before = this.storage.contentCount();
        await this.scheduler.runJobNow(job.id);
        const newItems = this.storage.contentCount() - before;

        this.lastRunAt.set(job.platform, Date.now());
        this.addDailyCount(job.platform, newItems);
        results.push({ platform: job.platform, newItems });

        console.log(`[SmartScheduler] ${job.platform}: +${newItems} (today: ${this.getDailyCount(job.platform)}/${DAILY_CAP_PER_PLATFORM})`);
      } catch (err) {
        console.error(`[SmartScheduler] ${job.platform} failed:`, err);
      }

      if (eligible.indexOf(job) < eligible.length - 1) {
        const jitter = Math.floor(Math.random() * STAGGER_MS * 0.3);
        await new Promise(r => setTimeout(r, STAGGER_MS + jitter));
      }
    }

    return results;
  }

  start(checkIntervalMs = 120_000): void {
    if (this.running) return;
    this.running = true;
    this.scheduler.startAll();
    console.log(`[SmartScheduler] Started — cap: ${DAILY_CAP_PER_PLATFORM}/platform/day, ${ITEMS_PER_SCRAPE}/scrape`);

    const loop = async () => {
      if (!this.running) return;
      try {
        const results = await this.runOnce();
        if (results.length > 0) {
          const total = results.reduce((s, r) => s + r.newItems, 0);
          console.log(`[SmartScheduler] Cycle: ${results.length} platforms, +${total} items`);
          if (total > 0 && this.onNewItems) this.onNewItems(total);
        }
      } catch (err) {
        console.error('[SmartScheduler] Loop error:', err);
      }
      const jitter = Math.floor(Math.random() * checkIntervalMs * 0.3);
      this.loopTimer = setTimeout(loop, checkIntervalMs + jitter);
    };

    loop();
  }

  stop(): void {
    this.running = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.scheduler.stopAll();
    console.log('[SmartScheduler] Stopped');
  }

  getYieldStats(): Record<string, { todayCount: number; cap: number; lastRun: number }> {
    const stats: Record<string, { todayCount: number; cap: number; lastRun: number }> = {};
    for (const [platform] of Object.entries(POLICIES)) {
      stats[platform] = {
        todayCount: this.getDailyCount(platform),
        cap: DAILY_CAP_PER_PLATFORM,
        lastRun: this.lastRunAt.get(platform) ?? 0,
      };
    }
    return stats;
  }
}
