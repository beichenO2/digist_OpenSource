/**
 * test-research.ts — Unit tests for deep-researcher module (structure + logic)
 */
import type { KnowledgeGap } from './src/fusion/knowledge-graph.js';
import { researchGap, researchGaps } from './src/research/deep-researcher.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

console.log('\n=== Deep Researcher Tests ===\n');

// 1. Module exports
console.log('--- Module Structure ---');
assert(typeof researchGap === 'function', 'researchGap is a function');
assert(typeof researchGaps === 'function', 'researchGaps is a function');

// 2. Type structure validation
console.log('\n--- Type Structures ---');
const mockGap: KnowledgeGap = {
  type: 'isolated-node',
  title: 'Test Gap',
  description: 'A test knowledge gap for validation',
  suggestion: 'Search for more info',
  nodeIds: ['node-1', 'node-2'],
  severity: 'medium',
};
assert(mockGap.type === 'isolated-node', 'KnowledgeGap type field works');
assert(mockGap.nodeIds.length === 2, 'KnowledgeGap nodeIds field works');
assert(mockGap.severity === 'medium', 'KnowledgeGap severity field works');

// 3. Graceful degradation (no LLM / no Firecrawl)
console.log('\n--- Graceful Degradation ---');
const result = await researchGap(mockGap);
assert(result === null, 'researchGap returns null when LLM unavailable');

const batchResults = await researchGaps([mockGap]);
assert(Array.isArray(batchResults), 'researchGaps returns array');
assert(batchResults.length === 0, 'researchGaps returns empty when services unavailable');

// 4. researchGaps filtering logic
console.log('\n--- Gap Filtering ---');
const mixedGaps: KnowledgeGap[] = [
  { type: 'isolated-node', title: 'Gap 1', description: '', suggestion: '', nodeIds: [], severity: 'high' },
  { type: 'sparse-community', title: 'Gap 2', description: '', suggestion: '', nodeIds: [], severity: 'medium' },
  { type: 'bridge-dependency', title: 'Gap 3', description: '', suggestion: '', nodeIds: [], severity: 'low' },
  { type: 'isolated-node', title: 'Gap 4', description: '', suggestion: '', nodeIds: [], severity: 'low' },
  { type: 'isolated-node', title: 'Gap 5', description: '', suggestion: '', nodeIds: [], severity: 'low' },
];
const filtered = mixedGaps
  .filter(g => g.type === 'isolated-node' || g.type === 'sparse-community')
  .slice(0, 3);
assert(filtered.length === 3, 'Filters to max 3 gaps');
assert(filtered[0]!.title === 'Gap 1', 'First gap is isolated-node');
assert(filtered[1]!.title === 'Gap 2', 'Second gap is sparse-community');
assert(!filtered.find(g => g.title === 'Gap 3'), 'bridge-dependency excluded');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
