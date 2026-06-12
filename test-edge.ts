import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { evaluateDensity, filterByDensity, rankByDensity } from './src/digestion/density-evaluator.js';
import { compressContent } from './src/digestion/context-compressor.js';
import { crossValidate } from './src/digestion/cross-validator.js';
import { KnowledgeGraph } from './src/fusion/knowledge-graph.js';
import { KnowledgeIndex } from './src/digestion/knowledge-index.js';
import { discoverLinks } from './src/fusion/semantic-linker.js';
import { detectConflicts } from './src/fusion/conflict-detector.js';
import { normalize, normalizeBatch, deduplicateByUrl } from './src/normalizer/index.js';
import { generateFusionReport } from './src/fusion/report-generator.js';
import type { ContentItem } from './src/types/index.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed++; } else { failed++; console.log(`  FAIL: ${name}`); }
}
function section(name: string) { console.log(`\n=== ${name} ===`); }

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 8),
    title: overrides.title ?? 'Test Title',
    body_markdown: overrides.body_markdown ?? 'Test body content for testing purposes.',
    author: overrides.author ?? 'tester',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    source_url: overrides.source_url ?? `https://example.com/${Math.random()}`,
    platform: overrides.platform ?? 'reddit',
    tags: overrides.tags ?? ['test'],
    raw_metadata: overrides.raw_metadata ?? {},
    scraped_at: overrides.scraped_at ?? new Date().toISOString(),
  };
}

// 1. Empty data
section('1. 空数据处理');
try {
  const emptyReport = evaluateDensity(makeItem({ body_markdown: '' }));
  assert(emptyReport.overall >= 0, 'empty body density >= 0');
  const emptyCompress = compressContent(makeItem({ body_markdown: '' }));
  assert(typeof emptyCompress.compressed_markdown === 'string', 'empty compress returns string');
  const emptyValidation = crossValidate([]);
  assert(emptyValidation.total_claims === 0, 'empty crossValidate');
  const emptyLinks = discoverLinks([]);
  assert(emptyLinks.total_links === 0, 'empty discoverLinks');
  const emptyConflicts = detectConflicts([]);
  assert(emptyConflicts.total_conflicts === 0, 'empty detectConflicts');
  const emptyNorm = normalizeBatch([]);
  assert(emptyNorm.length === 0, 'empty normalizeBatch');
  const emptyDedup = deduplicateByUrl([]);
  assert(emptyDedup.length === 0, 'empty dedup');
  const emptyFilter = filterByDensity([]);
  assert(emptyFilter.length === 0, 'empty filterByDensity');
  console.log('  全部通过');
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 2. Null/undefined fields
section('2. 空字段处理');
try {
  const nullItem = normalize({
    title: undefined as any,
    body_markdown: undefined as any,
    author: undefined as any,
    timestamp: undefined as any,
    source_url: '',
    platform: undefined as any,
    tags: undefined as any,
    raw_metadata: undefined as any,
  } as any);
  assert(nullItem.title === 'Untitled', 'null title -> Untitled');
  assert(nullItem.author === 'Unknown', 'null author -> Unknown');
  assert(typeof nullItem.timestamp === 'string', 'null timestamp -> ISO string');
  assert(nullItem.platform === 'other', 'null platform -> other');
  assert(Array.isArray(nullItem.tags), 'null tags -> array');
  console.log('  全部通过');
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 3. Very long text (100KB)
section('3. 超长文本 (100KB)');
try {
  const longText = 'This is a very long test sentence for stress testing. '.repeat(2000);
  const longItem = makeItem({ body_markdown: longText, title: 'Long test' });
  const longDensity = evaluateDensity(longItem);
  assert(longDensity.overall >= 0 && longDensity.overall <= 1, `long density: ${longDensity.overall}`);
  const longCompress = compressContent(longItem);
  assert(longCompress.compression_ratio < 1, `long compress ratio: ${longCompress.compression_ratio}`);
  assert(longCompress.summary_sentences.length > 0, 'long has summary');
  console.log(`  100KB -> density ${longDensity.overall.toFixed(2)}, ratio ${longCompress.compression_ratio.toFixed(2)}`);
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 4. Unicode / Emoji / CJK
section('4. Unicode/Emoji/CJK');
try {
  const unicodeItem = makeItem({
    title: '这是一个中文标题 🚀🤖 with émojis',
    body_markdown: '## 人工智能\n\n这是关于AI的讨论。GPT-4, Claude, Gemini 都很强大。\n\n```python\nprint("你好世界")\n```\n\n> 引用：科技改变世界 🌍\n\n- 列表项1 ✅\n- 列表项2 ❌',
    author: '测试用户',
    tags: ['中文', 'AI', '🤖'],
  });
  const uniDensity = evaluateDensity(unicodeItem);
  assert(uniDensity.overall >= 0, `unicode density: ${uniDensity.overall}`);
  const uniCompress = compressContent(unicodeItem);
  assert(uniCompress.key_phrases.length >= 0, 'unicode key phrases');
  assert(uniCompress.entities.length >= 0, 'unicode entities');
  console.log(`  CJK+emoji -> density ${uniDensity.overall.toFixed(2)}, ${uniCompress.entities.length} entities`);
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 5. Malformed timestamps
section('5. 畸形时间戳');
try {
  const badTimestamps = ['not-a-date', '2024-13-45', '', '0', 'yesterday'];
  for (const ts of badTimestamps) {
    const item = normalize({ timestamp: ts } as any);
    assert(typeof item.timestamp === 'string' && item.timestamp.length > 0, `"${ts}" -> valid string`);
  }
  console.log('  全部通过');
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 6. Duplicate URLs
section('6. URL去重');
try {
  const items = [
    makeItem({ source_url: 'https://example.com/same' }),
    makeItem({ source_url: 'https://example.com/same' }),
    makeItem({ source_url: 'https://example.com/different' }),
  ];
  const deduped = deduplicateByUrl(items);
  assert(deduped.length === 2, `dedup: 3 -> ${deduped.length}`);
  console.log('  全部通过');
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 7. Knowledge graph with single item
section('7. 单项知识图谱');
try {
  const g = new KnowledgeGraph();
  g.addItem(makeItem({ body_markdown: 'OpenAI released GPT-5 which uses TypeScript and React.' }));
  const stats = g.getStats();
  assert(stats.nodes > 0, `single item: ${stats.nodes} nodes`);
  console.log(`  1项 -> ${stats.nodes} nodes, ${stats.edges} edges`);
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 8. Knowledge index search on empty
section('8. 空索引搜索');
try {
  const idx = new KnowledgeIndex();
  const res = idx.search('anything', 5);
  assert(res.length === 0, 'empty index search returns []');
  const stats = idx.getStats();
  assert(stats.total_fragments === 0, 'empty index 0 fragments');
  console.log('  全部通过');
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 9. Report with single item
section('9. 单项报告生成');
try {
  const report = generateFusionReport([makeItem()], 'Single item test');
  assert(report.full_markdown.length > 50, `single report: ${report.full_markdown.length} chars`);
  assert(report.sources.length === 1, 'single source');
  console.log('  全部通过');
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 10. Cross-platform items
section('10. 跨平台数据');
try {
  const items = [
    makeItem({ platform: 'twitter', title: 'AI breakthrough', body_markdown: 'OpenAI launched new AI model that beats all benchmarks' }),
    makeItem({ platform: 'reddit', title: 'AI discussion', body_markdown: 'OpenAI new model is very impressive and beats benchmarks' }),
    makeItem({ platform: 'wechat', title: 'AI分析', body_markdown: 'OpenAI新模型发布，在多个基准测试中表现优异' }),
  ];
  const links = discoverLinks(items);
  assert(links.total_links >= 0, `cross-platform links: ${links.total_links}`);
  const conflicts = detectConflicts(items);
  assert(typeof conflicts.total_conflicts === 'number', 'conflicts check ok');
  const report = generateFusionReport(items, 'Cross-platform test');
  assert(report.sources.length === 3, '3 cross-platform sources');
  console.log(`  3平台 -> ${links.total_links} links, ${conflicts.total_conflicts} conflicts`);
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

// 11. Malformed / hostile HTML (cheerio + turndown stack, same as scrapers)
section('11. 畸形 HTML');
try {
  const turndown = new TurndownService();
  const malformedSnippets = [
    '<div><p>未闭合',
    '<table><tr><td>cell</table>',
    '<script>alert(1)</script><p>正文</p>',
    '<<<not>>><<tags>>',
    '<style>body{x:url(javascript:void(0))}</style><p>hi</p>',
    '\0\x01\x02 mixed with <div>text',
  ];
  for (const html of malformedSnippets) {
    const $ = cheerio.load(html);
    const md = turndown.turndown($.root().html() ?? '');
    const item = normalize(makeItem({ body_markdown: md || 'fallback' }));
    const d = evaluateDensity(item);
    const c = compressContent(item);
    assert(d.overall >= 0 && d.overall <= 1, `malformed density ok: ${html.slice(0, 20)}...`);
    assert(typeof c.compressed_markdown === 'string', 'malformed compress string');
  }
  console.log(`  ${malformedSnippets.length} 段畸形 HTML 全部通过`);
} catch (e) { failed++; console.log(`  CRASH: ${e}`); }

console.log(`\n${'='.repeat(45)}`);
console.log(`边界测试: ${passed} 通过 / ${failed} 失败`);
console.log(`${'='.repeat(45)}`);
if (failed > 0) process.exit(1);
