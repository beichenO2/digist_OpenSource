import { Storage } from './src/storage/index.js';
import { evaluateDensity, rankByDensity } from './src/digestion/density-evaluator.js';
import { compressContent, compressBatch } from './src/digestion/context-compressor.js';
import { crossValidate } from './src/digestion/cross-validator.js';
import { KnowledgeGraph } from './src/fusion/knowledge-graph.js';
import { KnowledgeIndex } from './src/digestion/knowledge-index.js';
import { discoverLinks } from './src/fusion/semantic-linker.js';
import { detectConflicts } from './src/fusion/conflict-detector.js';
import { generateFusionReport } from './src/fusion/report-generator.js';
import type { ContentItem } from './src/types/index.js';

function makeItem(i: number): ContentItem {
  const platforms: ContentItem['platform'][] = ['twitter', 'reddit', 'wechat'];
  return {
    id: `perf-${i}`,
    title: `Performance test item ${i} about AI and technology trends in ${2026 + Math.floor(i / 10)}`,
    body_markdown: `## Topic ${i}\n\nThis is a detailed analysis of artificial intelligence trends. OpenAI and Google are competing for dominance. TypeScript and Python remain the top languages.\n\n- Point ${i}.1: Machine learning models are getting larger\n- Point ${i}.2: Edge computing enables local AI inference\n- Point ${i}.3: Multi-agent systems are the future\n\nThe market is expected to grow by ${10 + i}% annually. Companies like Microsoft, Meta, and Anthropic are investing heavily.\n\n\`\`\`python\nmodel = load_model("gpt-${4 + (i % 3)}")\nresult = model.predict(data)\n\`\`\`\n\n> "AI will transform every industry" - Expert ${i}`,
    author: `author_${i % 20}`,
    timestamp: new Date(Date.now() - i * 3600000).toISOString(),
    source_url: `https://example.com/article-${i}`,
    platform: platforms[i % 3],
    tags: [`topic-${i % 5}`, 'ai', 'tech'],
    raw_metadata: { index: i, score: Math.random() * 100 },
    scraped_at: new Date().toISOString(),
  };
}

function bench(name: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const elapsed = performance.now() - start;
  return elapsed;
}

const N = 100;
const items = Array.from({ length: N }, (_, i) => makeItem(i));

console.log(`\n${'='.repeat(50)}`);
console.log(`  性能基准测试 — ${N} 条数据`);
console.log(`${'='.repeat(50)}\n`);

const memBefore = process.memoryUsage();

// 1. Density evaluation
const t1 = bench('密度评估', () => {
  for (const item of items) evaluateDensity(item);
});
console.log(`密度评估 (${N}x):    ${t1.toFixed(1)}ms  (${(t1/N).toFixed(2)}ms/item)`);

// 2. Context compression
const t2 = bench('上下文压缩', () => {
  compressBatch(items);
});
console.log(`上下文压缩 (${N}x):  ${t2.toFixed(1)}ms  (${(t2/N).toFixed(2)}ms/item)`);

// 3. Ranking
const t3 = bench('密度排序', () => {
  rankByDensity(items);
});
console.log(`密度排序 (${N}x):    ${t3.toFixed(1)}ms`);

// 4. Knowledge graph
const t4 = bench('知识图谱构建', () => {
  const g = new KnowledgeGraph();
  g.addBatch(items);
  g.getHubs(10);
  g.findBridgingEntities();
  g.getClusters();
});
console.log(`知识图谱 (${N}x):    ${t4.toFixed(1)}ms`);

// 5. Knowledge index
const t5 = bench('知识索引', () => {
  const idx = new KnowledgeIndex();
  idx.ingestBatch(items);
  idx.search('artificial intelligence', 10);
  idx.search('machine learning model', 10);
  idx.search('TypeScript Python', 10);
});
console.log(`知识索引+搜索 (${N}x): ${t5.toFixed(1)}ms`);

// 6. Cross validation (on subset)
const subset = items.slice(0, 20);
const t6 = bench('交叉验证', () => {
  crossValidate(subset);
});
console.log(`交叉验证 (20x):     ${t6.toFixed(1)}ms`);

// 7. Semantic links
const t7 = bench('语义关联', () => {
  discoverLinks(subset);
});
console.log(`语义关联 (20x):     ${t7.toFixed(1)}ms`);

// 8. Conflict detection
const t8 = bench('冲突检测', () => {
  detectConflicts(subset);
});
console.log(`冲突检测 (20x):     ${t8.toFixed(1)}ms`);

// 9. Full report
const t9 = bench('完整报告', () => {
  generateFusionReport(subset, 'Benchmark');
});
console.log(`完整报告 (20x):     ${t9.toFixed(1)}ms`);

// 10. Full pipeline
const t10 = bench('完整管道', () => {
  const ranked = rankByDensity(items);
  const digests = compressBatch(items);
  const graph = new KnowledgeGraph();
  graph.addBatch(items);
  const idx = new KnowledgeIndex();
  idx.ingestBatch(items);
  const validation = crossValidate(items.slice(0, 30));
  const links = discoverLinks(items.slice(0, 30));
  const report = generateFusionReport(items.slice(0, 30));
});
console.log(`完整管道 (${N}→30):  ${t10.toFixed(1)}ms`);

const memAfter = process.memoryUsage();
const memDelta = {
  rss: ((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(1),
  heap: ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(1),
};

console.log(`\n--- 内存 ---`);
console.log(`RSS 增量: ${memDelta.rss} MB`);
console.log(`Heap 增量: ${memDelta.heap} MB`);
console.log(`RSS 总量: ${(memAfter.rss / 1024 / 1024).toFixed(1)} MB`);
console.log(`Heap 总量: ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)} MB`);

const totalMs = t1 + t2 + t3 + t4 + t5 + t6 + t7 + t8 + t9;
console.log(`\n--- 总结 ---`);
console.log(`各模块总耗时: ${totalMs.toFixed(1)}ms`);
console.log(`完整管道耗时: ${t10.toFixed(1)}ms`);
console.log(`吞吐量: ${(N / (t10 / 1000)).toFixed(0)} items/sec`);
console.log(`${'='.repeat(50)}`);
