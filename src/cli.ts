import { Storage } from './storage/index.js';
import { Scheduler } from './scheduler/index.js';
import { redditScraper } from './scrapers/reddit.js';
import { glassBridgeScraper } from './scrapers/glass-bridge.js';
import { githubScraper } from './scrapers/github.js';
import { normalizeBatch, deduplicateByUrl, calculateInfoDensity } from './normalizer/index.js';
import {
  twitterScraper, xiaohongshuScraper,
  zhihuScraper, bloombergScraper,
} from './scrapers/safari-scraper.js';
import { bilibiliScraper } from './scrapers/bilibili.js';
import { v2exScraper } from './scrapers/v2ex.js';
import { wechatRssScraper as wechatScraper, wechatRssScraper } from './scrapers/wechat-rss.js';
import { firecrawlSearchScraper, isFirecrawlConfigured } from './scrapers/firecrawl-scraper.js';
import { arxivScraper } from './scrapers/arxiv.js';
import { hackerNewsScraper as hackernewsScraper } from './scrapers/hackernews.js';
import { youtubeScraper } from './scrapers/youtube.js';
import { collect } from './collector/layered-collector.js';
import { getStrategy } from './collector/registry.js';
import { mkdirSync } from 'fs';
import { compressBatch } from './digestion/context-compressor.js';
import { evaluateDensity } from './digestion/density-evaluator.js';
import { ingestBatchToRaw } from './wiki/raw-ingester.js';
import { compile as compileWiki } from './wiki/wiki-compiler.js';
import { generateFusionReport } from './fusion/report-generator.js';
import { pdfToMarkdown } from './preprocess/pdf-to-markdown.js';
import { downloadBilibiliVideo, discoverAndDownload } from './scrapers/bilibili-download.js';
import { digestVideo } from './preprocess/video-digest.js';
import { Recommender } from './recommend/index.js';
import { canScrapePlatformNow } from './scheduler/risk-window-policy.js';

const DB_PATH = process.env.DIGIST_DB || './data/digist.sqlite';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  mkdirSync('./data', { recursive: true });
  const storage = new Storage(DB_PATH);

  try {
    switch (command) {
      case 'scrape': {
        const platform = args[1];
        const query = args[2];
        if (!platform) {
          console.log('Usage: digist scrape <twitter|reddit|wechat|wechat-rss|github|glass|xiaohongshu|zhihu|arxiv|bilibili|hackernews|bloomberg|youtube|v2ex> <query>');
          break;
        }

        const scrapers: Record<string, typeof redditScraper> = {
          twitter: twitterScraper,
          reddit: redditScraper,
          wechat: wechatScraper,
          'wechat-rss': wechatRssScraper,
          github: githubScraper,
          glass: glassBridgeScraper,
          xiaohongshu: xiaohongshuScraper,
          zhihu: zhihuScraper,
          arxiv: arxivScraper,
          bilibili: bilibiliScraper,
          hackernews: hackernewsScraper,
          bloomberg: bloombergScraper,
          youtube: youtubeScraper,
          v2ex: v2exScraper,
        };

        const scraper = scrapers[platform];
        if (!scraper) {
          console.log(`Unknown platform: ${platform}. Use: twitter, reddit, wechat, wechat-rss, github, glass, xiaohongshu, zhihu, arxiv, bilibili, hackernews, bloomberg, youtube, v2ex`);
          break;
        }

        const noQueryPlatforms = ['glass', 'hackernews', 'bloomberg'];
        const q = noQueryPlatforms.includes(platform) ? (query ?? '') : query!;
        if (!noQueryPlatforms.includes(platform) && !query) {
          console.log('Usage: digist scrape <platform> <query>');
          break;
        }

        const policy = canScrapePlatformNow(platform);
        if (!policy.allowed) {
          console.log(`Skipped ${platform}: ${policy.reason}`);
          break;
        }

        const SAFARI_PLATFORMS = new Set(['twitter', 'xiaohongshu', 'zhihu', 'bloomberg']);
        const maxItems = SAFARI_PLATFORMS.has(platform) ? 10 : 20;
        const scraperLabel = SAFARI_PLATFORMS.has(platform) ? `${platform} (safari→L3 fallback)` : platform;

        console.log(`Scraping ${scraperLabel}: "${q || '(all recent)' }" (limit=${maxItems})...`);
        // Route through the LayeredCollector when the platform is registered
        // (gives L1→L3 fallback for free). The `wechat-rss` alias isn't in the
        // collector, so it still uses its direct scraper.
        const result = getStrategy(platform)
          ? await collect(platform, q, { maxItems })
          : await scraper.scrape(q, { maxItems });
        const normalized = normalizeBatch(result.items);
        const unique = deduplicateByUrl(normalized);
        const saved = storage.insertBatch(unique);

        console.log(`Scraped: ${result.items.length} | Normalized: ${normalized.length} | New: ${saved.length}`);

        for (const item of saved.slice(0, 5)) {
          const density = calculateInfoDensity(item);
          console.log(`  [${density.toFixed(2)}] ${item.title.slice(0, 80)}`);
        }

        if (result.has_more) {
          console.log(`More available. Next cursor: ${result.next_cursor}`);
        }
        break;
      }

      case 'search': {
        const query = args[1];
        if (!query) {
          console.log('Usage: digist search <query>');
          break;
        }
        const results = storage.searchContent(query);
        console.log(`Found ${results.length} results for "${query}":`);
        for (const item of results) {
          const density = calculateInfoDensity(item);
          console.log(`  [${item.platform}] [${density.toFixed(2)}] ${item.title.slice(0, 80)}`);
          console.log(`    ${item.source_url}`);
        }
        break;
      }

      case 'list': {
        const platform = args[1];
        const items = storage.listContent(platform, 20);
        console.log(`Content items (${storage.contentCount()} total):`);
        for (const item of items) {
          console.log(`  [${item.platform}] ${item.title.slice(0, 80)}`);
          console.log(`    ${item.source_url} | ${item.timestamp}`);
        }
        break;
      }

      case 'job': {
        const subCmd = args[1];
        const scheduler = new Scheduler(storage);

        switch (subCmd) {
          case 'add': {
            const platform = args[2];
            const query = args[3];
            const cronExpr = args[4] || '*/30 * * * *';
            if (!platform || !query) {
              console.log('Usage: digist job add <platform> <query> [cron_expr]');
              break;
            }
            const job = scheduler.addJob(platform, query, cronExpr);
            console.log(`Job created: ${job.id} (${platform}: "${query}" @ ${cronExpr})`);
            break;
          }
          case 'list': {
            const jobs = scheduler.listJobs();
            console.log(`Scheduled jobs (${jobs.length}):`);
            for (const j of jobs) {
              console.log(`  ${j.id} [${j.enabled ? 'ON' : 'OFF'}] ${j.platform}: "${j.query}" @ ${j.cron_expression}`);
              console.log(`    Last run: ${j.last_run_at || 'never'}`);
            }
            break;
          }
          case 'run': {
            const jobId = args[2];
            if (!jobId) {
              console.log('Usage: digist job run <job_id>');
              break;
            }
            const count = await scheduler.runJobNow(jobId);
            console.log(`Job ${jobId}: scraped ${count} new items`);
            break;
          }
          case 'remove': {
            const jobId = args[2];
            if (!jobId) {
              console.log('Usage: digist job remove <job_id>');
              break;
            }
            scheduler.removeJob(jobId);
            console.log(`Job ${jobId} removed`);
            break;
          }
          default:
            console.log('Usage: digist job <add|list|run|remove>');
        }
        break;
      }

      case 'stats': {
        console.log('DiGist Statistics:');
        console.log(`  Total content items: ${storage.contentCount()}`);
        const jobs = storage.listJobs();
        console.log(`  Scheduled jobs: ${jobs.length} (${jobs.filter(j => j.enabled).length} active)`);
        for (const platform of ['twitter', 'reddit', 'wechat', 'github', 'glass', 'xiaohongshu', 'zhihu', 'arxiv', 'bilibili', 'hackernews', 'bloomberg'] as const) {
          const items = storage.listContent(platform, 1);
          const count = storage.listContent(platform, 10000).length;
          console.log(`  ${platform}: ${count} items`);
        }
        break;
      }

      case 'bootstrap': {
        console.log('=== DiGist Bootstrap: Initializing full pipeline ===\n');

        const scheduler = new Scheduler(storage);
        const existingJobs = scheduler.listJobs();

        if (existingJobs.length === 0) {
          console.log('1. Creating default scrape jobs...');
          const defaults = [
            { platform: 'reddit', query: 'programming', cron: '*/30 * * * *' },
            { platform: 'reddit', query: 'artificial intelligence', cron: '*/30 * * * *' },
            { platform: 'github', query: 'trending', cron: '0 */2 * * *' },
          ];
          for (const d of defaults) {
            const j = scheduler.addJob(d.platform, d.query, d.cron);
            console.log(`  Created: ${j.id} (${d.platform}: "${d.query}")`);
          }
        } else {
          console.log(`1. ${existingJobs.length} jobs already exist, skipping creation.`);
        }

        console.log('\n2. Running sample crawl (reddit: programming)...');
        try {
          const result = await redditScraper.scrape('programming', { maxItems: 10 });
          const normalized = normalizeBatch(result.items);
          const unique = deduplicateByUrl(normalized);
          const saved = storage.insertBatch(unique);
          console.log(`  Scraped: ${result.items.length} | Saved: ${saved.length}`);

          if (saved.length > 0) {
            console.log('\n3. Running digestion pipeline...');
            const digests = compressBatch(saved);
            const densityScores = saved.map(item => evaluateDensity(item).overall);
            console.log(`  Compressed ${digests.length} items`);

            console.log('\n4. Writing to raw/ wiki pipeline...');
            const rawPaths = ingestBatchToRaw(saved, digests, densityScores);
            console.log(`  Wrote ${rawPaths.length} raw files`);

            console.log('\n5. Compiling wiki pages...');
            const wikiResult = await compileWiki();
            console.log(`  Created: ${wikiResult.pages_created.length} | Updated: ${wikiResult.pages_updated.length} | LLM: ${wikiResult.llm_available}`);

            console.log('\n6. Generating fusion report...');
            const report = generateFusionReport(saved.slice(0, 10));
            console.log(`  Report: "${report.title}" (${report.key_insights.length} insights)`);
          }
        } catch (err) {
          console.log(`  Crawl error (expected if no network): ${err}`);
          console.log('  Pipeline structure is ready — run crawl manually when network is available.');
        }

        console.log(`\n=== Bootstrap complete ===`);
        console.log(`  Database: ${DB_PATH}`);
        console.log(`  Content items: ${storage.contentCount()}`);
        console.log(`  Jobs: ${scheduler.listJobs().length}`);
        console.log(`  Web UI: cd web && npm run dev (port 3000)`);
        break;
      }

      case 'compile-wiki': {
        console.log('Compiling wiki pages from raw data...');
        const result = await compileWiki();
        console.log(`Created: ${result.pages_created.length} pages`);
        console.log(`Updated: ${result.pages_updated.length} pages`);
        console.log(`Items processed: ${result.items_processed}`);
        console.log(`LLM available: ${result.llm_available}`);
        console.log(`Duration: ${result.duration_ms}ms`);
        break;
      }

      case 'download': {
        const subCmd = args[1];
        if (subCmd === 'bilibili' || subCmd === 'bili') {
          const queryOrUrl = args[2];
          if (!queryOrUrl) {
            console.log('Usage:\n  digist download bilibili <BV_URL>            Download single video\n  digist download bilibili search <query> [n]   Discover & download top n videos');
            break;
          }
          if (queryOrUrl.startsWith('http') || queryOrUrl.startsWith('BV')) {
            const url = queryOrUrl.startsWith('BV')
              ? `https://www.bilibili.com/video/${queryOrUrl}`
              : queryOrUrl;
            await downloadBilibiliVideo(url, { quality: (args[3] as any) || '720p' });
          } else if (queryOrUrl === 'search') {
            const query = args[3];
            const n = parseInt(args[4] || '5', 10);
            if (!query) {
              console.log('Usage: digist download bilibili search <query> [max_items]');
              break;
            }
            await discoverAndDownload(query, { maxItems: n });
          } else {
            await discoverAndDownload(queryOrUrl, { maxItems: parseInt(args[3] || '5', 10) });
          }
        } else if (subCmd && subCmd.startsWith('http')) {
          const { execFile: ef } = await import('node:child_process');
          const { promisify: pr } = await import('node:util');
          const efAsync = pr(ef);
          const dir = './data/videos';
          const { mkdirSync: md } = await import('node:fs');
          md(dir, { recursive: true });
          console.log(`[Download] Downloading: ${subCmd}`);
          const { stdout } = await efAsync('yt-dlp', [
            '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
            '--merge-output-format', 'mp4',
            '-o', `${dir}/%(title).80s [%(id)s].%(ext)s`,
            '--no-playlist', '--no-overwrites', subCmd,
          ], { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
          console.log(stdout);
        } else {
          console.log('Usage:\n  digist download bilibili <url|query>     Bilibili videos\n  digist download <any_url>                 Any yt-dlp supported URL (YouTube, Twitter, etc.)');
        }
        break;
      }

      case 'recommend':
      case 'for-you': {
        const firstArg = args[1];
        const isNum = firstArg && /^\d+$/.test(firstArg);
        const platform = isNum ? undefined : firstArg;
        const n = parseInt((isNum ? firstArg : args[2]) || '15', 10);
        console.log('Building recommendation profile...');
        const recommender = new Recommender(storage);
        recommender.buildProfile();
        const recs = recommender.forYou({
          maxItems: n,
          platforms: platform ? [platform] : undefined,
        });
        console.log(`\n📋 为你推荐 (${recs.length} items):\n`);
        for (let i = 0; i < recs.length; i++) {
          const r = recs[i];
          const scoreStr = (r.score * 100).toFixed(0);
          console.log(`${i + 1}. [${scoreStr}%] [${r.item.platform}] ${r.item.title.slice(0, 80)}`);
          console.log(`   ${r.reason} | ${r.item.source_url}`);
          console.log(`   R:${(r.signals.relevance * 100).toFixed(0)} D:${(r.signals.density * 100).toFixed(0)} F:${(r.signals.freshness * 100).toFixed(0)} X:${(r.signals.crossPlatform * 100).toFixed(0)} N:${(r.signals.novelty * 100).toFixed(0)}`);
        }
        break;
      }

      case 'digest-video': {
        const urlOrPath = args[1];
        if (!urlOrPath) {
          console.log('Usage: digist digest-video <bilibili_url|video_path> [--lang zh|en] [--asr-model Qwen/Qwen3-ASR-0.6B]');
          break;
        }
        const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'Chinese';
        const wModel = args.includes('--asr-model') ? args[args.indexOf('--asr-model') + 1] : 'Qwen/Qwen3-ASR-0.6B';
        const result = await digestVideo(urlOrPath, {
          language: lang,
          whisperModel: wModel as any,
        });
        console.log(`\nTitle: ${result.title}`);
        console.log(`Method: ${result.method}`);
        console.log(`Duration: ${Math.round(result.durationSeconds)}s`);
        if (result.transcriptPath) console.log(`Transcript: ${result.transcriptPath}`);
        if (result.summaryPath) console.log(`Summary: ${result.summaryPath}`);
        if (result.summary) {
          console.log(`\n${'='.repeat(50)}`);
          console.log(result.summary.slice(0, 2000));
          if (result.summary.length > 2000) console.log('\n... (truncated)');
        }
        break;
      }

      case 'preprocess': {
        const filePath = args[1];
        if (!filePath) {
          console.log('Usage: digist preprocess <file.pdf>');
          break;
        }
        if (filePath.endsWith('.pdf')) {
          console.log(`Converting PDF: ${filePath}`);
          const result = await pdfToMarkdown(filePath);
          if (result.success) {
            console.log(`Method: ${result.method} | Pages: ${result.pages}`);
            console.log(`Output (${result.markdown.length} chars):\n`);
            console.log(result.markdown.slice(0, 2000));
            if (result.markdown.length > 2000) console.log('\n... (truncated)');
          } else {
            console.error(`Failed: ${result.error}`);
          }
        } else {
          console.log(`Unsupported format. Supported: .pdf`);
        }
        break;
      }

      default:
        console.log(`DiGist CLI — AI Self-Evolution Information Digestion Engine

Usage:
  digist scrape <platform> [query]                 Scrape content
  digist search <query>                            Search stored content
  digist list [platform]                           List stored content
  digist job add <platform> <query> [cron]         Add scheduled job
  digist job list                                  List scheduled jobs
  digist job run <job_id>                           Run job immediately
  digist job remove <job_id>                        Remove scheduled job
  digist for-you [platform] [n]                     Personalized recommendations
  digist download bilibili <url|query> [n]          Download bilibili video(s)
  digist download <any_url>                        Download from YouTube/Twitter/etc.
  digist digest-video <url|path>                   Download + transcribe + LLM summarize
  digist preprocess <file.pdf>                     Convert PDF to Markdown
  digist bootstrap                                 Initialize full pipeline
  digist compile-wiki                              Compile raw data into wiki pages
  digist stats                                     Show statistics`);
    }
  } finally {
    storage.close();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
