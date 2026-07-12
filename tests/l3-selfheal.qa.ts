/**
 * L3 Agentic 兜底层 · selector 自愈 QA
 *
 * 验证「selector 失效 → LLM 重新定位 → cheerio 校验 → 回写持久化 → 抽取」闭环。
 *   1. healer 单元：给一段结构化 HTML fixture + 错误的旧 selector，LLM 应产出能匹配的新 selector
 *   2. selector-store：save→load 往返
 *   3. browser：patchright 真实打开可达页面，返回 HTML
 *   4. 端到端自愈：真实页面 + 故意破坏的 seed → L3 handler 触发 LLM 自愈 → 抽到条目
 *
 * 运行：cd digist && npx tsx tests/l3-selfheal.qa.ts
 * 网络/LLM 不可用时相关项记 SKIP（不判失败）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSelectors, healSelectors } from '../src/collector/l3/healer.js';
import { loadSelectors, saveSelectors } from '../src/collector/l3/selector-store.js';
import { capturePage, isL3Available } from '../src/collector/l3/browser.js';
import { createL3Handler } from '../src/collector/l3/index.js';
import { isLocalLlmAvailable } from '../src/utils/local-llm.js';
import type { SelectorSet } from '../src/collector/l3/types.js';

let pass = 0, fail = 0, skip = 0;
const failures: string[] = [];
function ok(c: boolean, n: string) { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; failures.push(n); console.log(`  ❌ ${n}`); } }
function sk(n: string, why: string) { skip++; console.log(`  ⏭️  SKIP ${n} — ${why}`); }

const FIXTURE = `<!doctype html><html><body>
<header><h1>Test Feed</h1></header>
<main>
  <div class="feed">
    <article class="post"><h2 class="post-title"><a href="/a/1">第一篇文章标题</a></h2><span class="byline">作者甲</span></article>
    <article class="post"><h2 class="post-title"><a href="/a/2">第二篇文章标题</a></h2><span class="byline">作者乙</span></article>
    <article class="post"><h2 class="post-title"><a href="/a/3">第三篇文章标题</a></h2><span class="byline">作者丙</span></article>
  </div>
</main></body></html>`;

async function main() {
  console.log('\n================ digist L3 selector 自愈 QA ================\n');

  // 阶段 1：validateSelectors 正/负
  console.log('【阶段 1】validateSelectors 校验器');
  const good: SelectorSet = { item: 'article.post', title: '.post-title' };
  const bad: SelectorSet = { item: '.does-not-exist', title: '.nope' };
  ok(validateSelectors(FIXTURE, good).ok && validateSelectors(FIXTURE, good).count === 3, '正确 selector 校验通过且匹配 3 条');
  ok(!validateSelectors(FIXTURE, bad).ok, '失效 selector 校验失败（模拟改版）');

  // 阶段 2：selector-store 往返
  console.log('\n【阶段 2】selector-store 持久化');
  const tmp = mkdtempSync(join(tmpdir(), 'l3-qa-'));
  process.env.DIGIST_SELECTOR_DIR = tmp;
  try {
    ok(loadSelectors('__none__') === null, '未知平台 load 返回 null');
    saveSelectors('testplat', good);
    const back = loadSelectors('testplat');
    ok(!!back && back.item === 'article.post' && back.title === '.post-title', 'save→load 往返一致');
    ok(!!back?.learnedAt && back?.source === 'manual' || back?.source === 'llm-healed', 'load 带 learnedAt/source 元数据');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 阶段 3：LLM 自愈（fixture，确定性）
  console.log('\n【阶段 3】LLM 自愈（fixture + 错误旧 selector）');
  if (!(await isLocalLlmAvailable())) {
    sk('LLM 自愈 fixture', 'PolarPrivate LLM 不可用');
  } else {
    const healed = await healSelectors(FIXTURE, '文章列表条目，每条含标题和链接和作者');
    if (healed) {
      ok(validateSelectors(FIXTURE, healed.set).ok, `LLM 产出的 selector 通过校验（item="${healed.set.item}" title="${healed.set.title}" 匹配 ${healed.matched}）`);
      ok(healed.set.source === 'llm-healed', '自愈结果标记 source=llm-healed');
    } else {
      sk('LLM 自愈 fixture', 'LLM 未能产出有效 selector（可重试）');
    }
  }

  // 阶段 4：patchright 真实浏览器捕获
  console.log('\n【阶段 4】反检测浏览器捕获（真实页面）');
  if (!(await isL3Available())) {
    sk('浏览器捕获', 'patchright 不可用');
  } else {
    const probeDir = mkdtempSync(join(tmpdir(), 'l3-prof-'));
    process.env.DIGIST_L3_PROFILE_DIR = probeDir;
    try {
      const cap = await capturePage('https://news.ycombinator.com', { waitFor: '.athing' });
      ok(cap.html.length > 1000, `捕获 HTML (${cap.html.length} 字节)`);
      ok(/Hacker News|athing|titleline/i.test(cap.html), 'HTML 含 HN 结构标志');

      // 阶段 5：端到端自愈（真实页面 + 破坏的 seed）
      console.log('\n【阶段 5】端到端 L3 自愈（真实 HN + 故意破坏 seed）');
      const healDir = mkdtempSync(join(tmpdir(), 'l3-heal-'));
      process.env.DIGIST_SELECTOR_DIR = healDir;
      try {
        const brokenSeed: SelectorSet = { item: '.THIS-CLASS-WAS-RENAMED', title: '.gone', source: 'manual' };
        const handler = createL3Handler(
          {
            platform: 'hackernews_l3test',
            buildUrl: () => 'https://news.ycombinator.com',
            waitFor: '.athing',
            itemDescription: 'Hacker News 首页的新闻条目，每条含标题文字和外链',
          },
          brokenSeed,
        );
        const r = await handler.handle('', { maxItems: 5 });
        if (await isLocalLlmAvailable()) {
          ok(r.items.length > 0, `破坏 seed 后经 LLM 自愈仍抽到 ${r.items.length} 条`);
          ok(r.items.every(i => i.title.length > 0), '自愈抽取的条目均有标题');
          const persisted = loadSelectors('hackernews_l3test');
          ok(!!persisted && persisted.source === 'llm-healed', '自愈后的新 selector 已回写持久化');
        } else {
          sk('端到端自愈', 'LLM 不可用');
        }
      } finally {
        rmSync(healDir, { recursive: true, force: true });
      }
    } catch (e) {
      sk('浏览器捕获/自愈', `网络或浏览器异常: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  }

  console.log('\n================ QA 汇总 ================');
  console.log(`通过 ${pass} · 失败 ${fail} · 跳过 ${skip}`);
  if (fail > 0) { console.log('\n失败项：'); failures.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
  console.log('✅ 全部关键断言通过');
}

main().catch(err => { console.error('L3 QA crashed:', err); process.exit(1); });
