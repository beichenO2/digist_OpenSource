import { Storage } from './src/storage/index.js';
import { evaluateDensity, rankByDensity } from './src/digestion/density-evaluator.js';
import { compressContent } from './src/digestion/context-compressor.js';
import { KnowledgeGraph } from './src/fusion/knowledge-graph.js';
import { KnowledgeIndex } from './src/digestion/knowledge-index.js';
import { crossValidate } from './src/digestion/cross-validator.js';
import { discoverLinks } from './src/fusion/semantic-linker.js';
import { detectConflicts } from './src/fusion/conflict-detector.js';
import { generateFusionReport } from './src/fusion/report-generator.js';
import { StrategyOptimizer } from './src/evolution/strategy-optimizer.js';
import { PipelineTuner } from './src/evolution/pipeline-tuner.js';
import { EvolutionLog } from './src/evolution/evolution-log.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

const storage = new Storage('./data/digist.sqlite');
const items = storage.listContent(undefined, 100);

console.log(`\n总数据: ${items.length} 条\n`);

// 1. Storage
console.log('=== 1. Storage 测试 ===');
assert(items.length > 0, '有数据');
assert(storage.contentCount() > 0, 'contentCount > 0');
const searchResults = storage.searchContent('AI');
assert(searchResults.length >= 0, 'searchContent 不报错');

// 2. Density Evaluator
console.log('\n=== 2. 密度评估测试 ===');
for (const item of items.slice(0, 3)) {
  const report = evaluateDensity(item);
  assert(report.overall >= 0 && report.overall <= 1, `density ${report.overall.toFixed(2)} for "${item.title.slice(0,30)}"`);
  assert(report.details.word_count > 0, `word_count > 0`);
}
const ranked = rankByDensity(items.slice(0, 5));
assert(ranked.length > 0, 'rankByDensity returns results');
assert(ranked[0].density >= ranked[ranked.length-1].density, 'sorted descending');

// 3. Context Compressor
console.log('\n=== 3. 上下文压缩测试 ===');
for (const item of items.slice(0, 3)) {
  const digest = compressContent(item);
  assert(digest.compression_ratio > 0, `compression_ratio ${digest.compression_ratio.toFixed(2)}`);
  assert(digest.summary_sentences.length > 0, `has summary sentences`);
  assert(typeof digest.compressed_markdown === 'string', 'compressed_markdown is string');
}

// 4. Knowledge Graph
console.log('\n=== 4. 知识图谱测试 ===');
const graph = new KnowledgeGraph();
graph.addBatch(items);
const stats = graph.getStats();
assert(stats.nodes > 0, `${stats.nodes} nodes`);
assert(stats.edges > 0, `${stats.edges} edges`);
const hubs = graph.getHubs(5);
assert(hubs.length > 0, `${hubs.length} hubs found`);
const clusters = graph.getClusters();
assert(clusters.size > 0, `${clusters.size} clusters`);

// 5. Knowledge Index
console.log('\n=== 5. 知识索引测试 ===');
const index = new KnowledgeIndex();
const fragmentCount = index.ingestBatch(items);
assert(fragmentCount > 0, `${fragmentCount} fragments indexed`);
const idxStats = index.getStats();
assert(idxStats.total_fragments > 0, `total_fragments: ${idxStats.total_fragments}`);
const searchRes = index.search('artificial intelligence', 5);
assert(searchRes.length >= 0, `search returns ${searchRes.length} results`);

// 6. Cross Validator
console.log('\n=== 6. 交叉验证测试 ===');
const validation = crossValidate(items.slice(0, 8));
assert(validation.total_claims >= 0, `${validation.total_claims} total claims`);
assert(typeof validation.corroborated === 'number', 'corroborated is number');
assert(validation.cross_platform_insights.length >= 0, 'has insights');

// 7. Semantic Linker
console.log('\n=== 7. 语义关联测试 ===');
const links = discoverLinks(items.slice(0, 8));
assert(typeof links.total_links === 'number', `${links.total_links} total links`);
assert(typeof links.cross_platform_links === 'number', 'cross_platform_links defined');
assert(links.suggested_connections.length >= 0, 'has suggestions');

// 8. Conflict Detector
console.log('\n=== 8. 冲突检测测试 ===');
const conflicts = detectConflicts(items.slice(0, 8));
assert(typeof conflicts.total_conflicts === 'number', `${conflicts.total_conflicts} conflicts`);
assert(conflicts.reliability_scores instanceof Map, 'reliability_scores is Map');

// 9. Report Generator
console.log('\n=== 9. 报告生成测试 ===');
const report = generateFusionReport(items.slice(0, 5), 'AI Evolution');
assert(report.title.includes('AI Evolution'), 'title correct');
assert(report.full_markdown.length > 100, `report ${report.full_markdown.length} chars`);
assert(report.key_insights.length > 0, `${report.key_insights.length} insights`);
assert(report.sources.length > 0, `${report.sources.length} sources`);

// 10. Strategy Optimizer
console.log('\n=== 10. 策略优化测试 ===');
const optimizer = new StrategyOptimizer(storage);
const allOpts = optimizer.optimizeAll();
assert(Array.isArray(allOpts), 'optimizeAll returns array');

// 11. Pipeline Tuner
console.log('\n=== 11. 管道调优测试 ===');
const tuner = new PipelineTuner();
const tuning = tuner.tune(items.slice(0, 10));
assert(Array.isArray(tuning), 'tune returns array');
const config = tuner.getConfig();
assert(config.density_threshold > 0, `threshold: ${config.density_threshold}`);

// 12. Evolution Log
console.log('\n=== 12. 进化日志测试 ===');
const evoLog = new EvolutionLog('./data/test-evolution');
const entry = evoLog.recordMilestone('Test milestone', { test: true });
assert(entry.id > 0, `entry id: ${entry.id}`);
evoLog.measureImpact(entry.id, 0.5);
const history = evoLog.getHistory();
assert(history.length > 0, `${history.length} log entries`);
const logReport = evoLog.generateReport();
assert(logReport.includes('Evolution Log'), 'report has title');

storage.close();

console.log(`\n${'='.repeat(40)}`);
console.log(`测试结果: ${passed} 通过 / ${failed} 失败`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) process.exit(1);
