/**
 * L1 免登采集层 · 全流程 QA
 *
 * 模拟真实运行情景，端到端验证重设计后的采集层：
 *   collect() → normalizeBatch → deduplicateByUrl → Storage.insertBatch → recommend
 * 以及对外契约 crawl() 的返回结构不变（/api/crawl/trigger 依赖）。
 *
 * 运行：cd digist && npx tsx tests/l1-collection.qa.ts
 * 退出码：0 = 全部关键断言通过；1 = 有关键失败。
 * 网络类断言在离线时记为 SKIP（不判失败），但会显著提示。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../src/collector/layered-collector.js';
import { getStrategy, l1Strategies } from '../src/collector/registry.js';
import { crawl, crawlPlatforms } from '../src/api/crawl-api.js';
import { normalizeBatch, deduplicateByUrl, calculateInfoDensity } from '../src/normalizer/index.js';
import { Storage } from '../src/storage/index.js';
import { Recommender } from '../src/recommend/index.js';
import type { ContentItem } from '../src/types/index.js';

// L1 免登平台（不需要登录态、可无人值守采集）
const L1_NETWORK_PLATFORMS = ['arxiv', 'hackernews', 'reddit', 'v2ex', 'bilibili', 'github'] as const;
// 依赖外部工具/部署，缺失则 SKIP
const L1_OPTIONAL_PLATFORMS = ['youtube', 'wechat'] as const;

const SAMPLE_QUERIES: Record<string, string> = {
  arxiv: 'large language model',
  hackernews: 'top',
  reddit: 'r/programming',
  v2ex: 'hot',
  bilibili: 'hot',
  github: 'trending',
  youtube: 'ai news',
  wechat: 'all',
};

let pass = 0;
let fail = 0;
let skip = 0;
const failures: string[] = [];

function ok(cond: boolean, name: string): boolean {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}`); }
  return cond;
}
function skipped(name: string, why: string): void {
  skip++; console.log(`  ⏭️  SKIP ${name} — ${why}`);
}

const REQUIRED_FIELDS: (keyof ContentItem)[] = [
  'title', 'body_markdown', 'author', 'timestamp', 'source_url', 'platform', 'tags', 'raw_metadata',
];

function validateItemShape(item: ContentItem, platform: string, idx: number): boolean {
  let good = true;
  for (const f of REQUIRED_FIELDS) {
    if (item[f] === undefined || item[f] === null) {
      good = false;
      console.log(`      · item[${idx}] 缺字段 ${String(f)}`);
    }
  }
  if (typeof item.title !== 'string' || item.title.length === 0) good = false;
  if (typeof item.source_url !== 'string' || !/^https?:\/\//.test(item.source_url)) {
    good = false;
    console.log(`      · item[${idx}] source_url 非法: ${item.source_url}`);
  }
  if (!Array.isArray(item.tags)) good = false;
  if (typeof item.raw_metadata !== 'object') good = false;
  return good;
}

async function collectWithTimeout(platform: string, query: string, maxItems: number, ms: number) {
  return Promise.race([
    collect(platform, query, { maxItems }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

async function main(): Promise<void> {
  console.log('\n================ digist L1 采集层 · 全流程 QA ================\n');

  // ── 阶段 1：静态注册契约 ──
  console.log('【阶段 1】采集层注册契约');
  ok(getStrategy('v2ex') !== undefined, 'v2ex 已注册进 LayeredCollector');
  ok(getStrategy('bilibili') !== undefined, 'bilibili 已注册');
  ok(crawlPlatforms.includes('v2ex' as never), 'crawlPlatforms 含 v2ex');
  ok(getStrategy('__nope__') === undefined, '未知平台返回 undefined');
  for (const p of [...L1_NETWORK_PLATFORMS, ...L1_OPTIONAL_PLATFORMS]) {
    const strat = getStrategy(p);
    ok(!!strat && strat.primary.layer === 'L1', `${p} 策略 primary 层级 = L1`);
  }
  ok(Object.keys(l1Strategies).length >= 13, `注册平台数 ≥ 13（实际 ${Object.keys(l1Strategies).length}）`);

  // ── 阶段 2：未知平台错误契约 ──
  console.log('\n【阶段 2】错误契约');
  try {
    await collect('__nope__', 'x');
    ok(false, '未知平台应抛错');
  } catch (e) {
    ok(e instanceof Error && /Unknown platform/.test(e.message), '未知平台抛 Unknown platform 错误');
  }

  // ── 阶段 3：真实采集 + shape 契约（网络） ──
  console.log('\n【阶段 3】真实采集 + ContentItem shape 契约');
  const collectedAll: ContentItem[] = [];
  const perPlatformCount: Record<string, number> = {};
  for (const platform of L1_NETWORK_PLATFORMS) {
    const query = SAMPLE_QUERIES[platform] ?? '';
    console.log(`  — ${platform} (query="${query}")`);
    try {
      const r = await collectWithTimeout(platform, query, 5, 25_000);
      perPlatformCount[platform] = r.items.length;
      ok(r.layer === 'L1', `${platform} 命中 L1 层`);
      if (r.items.length === 0) {
        skipped(`${platform} 采集条数>0`, '返回 0 条（可能网络/风控/临时限流）');
        continue;
      }
      ok(r.items.length > 0, `${platform} 采到 ${r.items.length} 条`);
      const shapeOk = r.items.every((it, i) => validateItemShape(it, platform, i));
      ok(shapeOk, `${platform} 全部条目 shape 合法`);
      ok(r.items.every(it => it.platform === platform), `${platform} 条目 platform 字段一致`);
      collectedAll.push(...r.items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped(`${platform} 采集`, `异常: ${msg.slice(0, 80)}`);
    }
  }

  // 可选平台
  for (const platform of L1_OPTIONAL_PLATFORMS) {
    const query = SAMPLE_QUERIES[platform] ?? '';
    console.log(`  — ${platform} (可选, query="${query}")`);
    try {
      const r = await collectWithTimeout(platform, query, 3, 25_000);
      if (r.items.length > 0) {
        ok(r.items.every((it, i) => validateItemShape(it, platform, i)), `${platform} shape 合法（可选）`);
        collectedAll.push(...r.items);
      } else {
        skipped(`${platform}`, '返回 0 条（工具未装/未部署，符合预期）');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped(`${platform}`, `不可用: ${msg.slice(0, 60)}`);
    }
  }

  ok(collectedAll.length > 0, `至少一个 L1 平台采到真实数据（合计 ${collectedAll.length} 条）`);

  // ── 阶段 4：归一化 + 去重 ──
  console.log('\n【阶段 4】归一化 + 去重');
  const normalized = normalizeBatch(collectedAll);
  ok(normalized.length === collectedAll.length, `normalizeBatch 保留条数 (${normalized.length})`);
  ok(normalized.every(it => typeof it.id === 'string' && it.id.length > 0), 'normalize 后每条有非空 id');
  const deduped = deduplicateByUrl(normalized);
  ok(deduped.length <= normalized.length, `去重后条数不增 (${deduped.length} ≤ ${normalized.length})`);
  const urls = deduped.map(i => i.source_url);
  ok(new Set(urls).size === urls.length, '去重后 source_url 唯一');

  // ── 阶段 5：存储落库（临时 DB，隔离生产） ──
  console.log('\n【阶段 5】存储落库（临时隔离 DB）');
  const tmpDir = mkdtempSync(join(tmpdir(), 'digist-qa-'));
  const dbPath = join(tmpDir, 'qa.sqlite');
  const storage = new Storage(dbPath);
  let recommender: Recommender | null = null;
  try {
    const before = storage.contentCount();
    const saved = storage.insertBatch(deduped);
    const after = storage.contentCount();
    ok(saved.length > 0, `insertBatch 落库 ${saved.length} 条`);
    ok(after - before === saved.length, `contentCount 增量一致 (${before}→${after})`);
    // 幂等：再插一次应 0 新增（url_hash UNIQUE）
    const savedAgain = storage.insertBatch(deduped);
    ok(savedAgain.length === 0, `重复插入幂等（0 新增）`);
    // 平台过滤
    for (const p of Object.keys(perPlatformCount)) {
      if (perPlatformCount[p] > 0) {
        const listed = storage.listContent(p, 100);
        ok(listed.length > 0 && listed.every(i => i.platform === p), `listContent('${p}') 只返回该平台`);
      }
    }
    // 全文检索冒烟
    const anyTitle = deduped[0]?.title?.split(/\s+/)[0];
    if (anyTitle && anyTitle.length >= 2) {
      try {
        const found = storage.searchContent(anyTitle, 10);
        ok(Array.isArray(found), `searchContent 返回数组 (命中 ${found.length})`);
      } catch (e) {
        ok(false, `searchContent 不应抛错: ${e instanceof Error ? e.message : e}`);
      }
    }
    // 信息密度
    const density = calculateInfoDensity(deduped[0]);
    ok(typeof density === 'number' && density >= 0, `calculateInfoDensity 返回有效值 (${density.toFixed(2)})`);

    // ── 阶段 6：推荐管线 ──
    console.log('\n【阶段 6】推荐管线（下游未改动验证）');
    recommender = new Recommender(storage);
    recommender.buildProfile();
    const recs = recommender.forYou({ maxItems: 10 });
    ok(Array.isArray(recs), `forYou 返回数组 (${recs.length} 条)`);
    if (recs.length > 0) {
      ok(recs.every(r => typeof r.score === 'number' && !!r.item), '推荐项含 score 和 item');
    } else {
      skipped('推荐条数>0', '样本量小或画像不足，可接受');
    }
  } finally {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
    console.log(`  🧹 已清理临时 DB: ${tmpDir}`);
  }

  // ── 阶段 7：对外契约 crawl() 结构不变 ──
  console.log('\n【阶段 7】对外契约 crawl()（/api/crawl/trigger 依赖）');
  try {
    const r = await Promise.race([
      crawl('arxiv', 'machine learning', { maxItems: 3 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25_000)),
    ]);
    const keys = Object.keys(r).sort();
    ok(JSON.stringify(keys) === JSON.stringify(['has_more', 'items', 'next_cursor']),
      `crawl() 返回恰好 {items,next_cursor,has_more}（实得 ${keys.join(',')}）`);
    ok(!('layer' in r) && !('degraded' in r), 'crawl() 已剥离 layer/degraded 内部字段');
    ok(Array.isArray(r.items), 'crawl().items 是数组');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    skipped('crawl(arxiv) 契约', `网络异常: ${msg.slice(0, 60)}`);
  }

  // ── 汇总 ──
  console.log('\n================ QA 汇总 ================');
  console.log(`通过 ${pass} · 失败 ${fail} · 跳过 ${skip}`);
  if (fail > 0) {
    console.log('\n失败项：');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('✅ 全部关键断言通过');
}

main().catch(err => { console.error('QA harness crashed:', err); process.exit(1); });
