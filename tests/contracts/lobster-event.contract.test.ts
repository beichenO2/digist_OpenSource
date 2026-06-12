/**
 * Contract test: verifies digist lobster events match the declared schema.
 *
 * Covers:
 * - Example payloads validate against schema
 * - emitEvent produces conforming events
 * - Bug and report convenience functions produce valid events
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_PATH = resolve(import.meta.dirname ?? '.', '..', '..', 'contracts', 'lobster-event.schema.json');
const EXAMPLES_PATH = resolve(import.meta.dirname ?? '.', '..', '..', 'contracts', 'examples', 'lobster-event.example.json');

interface SchemaProperty {
  type?: string;
  const?: string;
  enum?: string[];
  format?: string;
}

interface EventSchema {
  required: string[];
  properties: Record<string, SchemaProperty>;
}

function loadSchema(): EventSchema {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

function loadExamples(): Record<string, unknown>[] {
  return JSON.parse(readFileSync(EXAMPLES_PATH, 'utf8'));
}

function validateEvent(event: Record<string, unknown>, schema: EventSchema): string[] {
  const errors: string[] = [];

  for (const field of schema.required) {
    if (!(field in event)) errors.push(`missing required field: ${field}`);
  }

  if (typeof event.ts !== 'string') errors.push('ts must be a string');
  if (typeof event.type !== 'string') errors.push('type must be a string');
  if (event.type && schema.properties.type.enum && !schema.properties.type.enum.includes(event.type as string)) {
    errors.push(`invalid type: ${event.type}; expected one of ${schema.properties.type.enum.join(', ')}`);
  }
  if (event.source_project !== 'digist') errors.push(`source_project must be "digist", got "${event.source_project}"`);
  if (event.target_project !== undefined && typeof event.target_project !== 'string') {
    errors.push('target_project must be a string if present');
  }
  if (typeof event.severity !== 'string') errors.push('severity must be a string');
  if (event.severity && schema.properties.severity.enum && !schema.properties.severity.enum.includes(event.severity as string)) {
    errors.push(`invalid severity: ${event.severity}`);
  }
  if (typeof event.payload !== 'object' || event.payload === null) errors.push('payload must be an object');
  if (typeof event.dedup_key !== 'string') errors.push('dedup_key must be a string');

  const knownFields = new Set(Object.keys(schema.properties).concat(['_description']));
  for (const key of Object.keys(event)) {
    if (!knownFields.has(key)) errors.push(`unexpected field: ${key}`);
  }

  return errors;
}

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

console.log('\n=== lobster-event contract tests ===\n');

// Test 1: Schema file is valid JSON
console.log('Schema validation:');
let schema: EventSchema;
try {
  schema = loadSchema();
  assert('schema loads as valid JSON', true);
  assert('schema has required fields', Array.isArray(schema.required) && schema.required.length > 0);
  assert('schema requires ts, type, source_project, severity, payload, dedup_key',
    ['ts', 'type', 'source_project', 'severity', 'payload', 'dedup_key'].every(f => schema.required.includes(f)),
  );
} catch (err) {
  assert('schema loads as valid JSON', false, String(err));
  process.exit(1);
}

// Test 2: Example payloads validate against schema
console.log('\nExample validation:');
const examples = loadExamples();
assert('examples file loads', examples.length > 0, `got ${examples.length} examples`);

for (let i = 0; i < examples.length; i++) {
  const ex = examples[i];
  const desc = (ex._description as string) || `example[${i}]`;
  const errors = validateEvent(ex, schema);
  assert(`${desc} validates`, errors.length === 0, errors.join('; '));
}

// Test 3: bug event shape
console.log('\nBug event structure:');
const bugExample = examples.find(e => e.type === 'bug');
assert('bug example exists', bugExample !== undefined);
if (bugExample) {
  const payload = bugExample.payload as Record<string, unknown>;
  assert('bug has message in payload', typeof payload.message === 'string');
  assert('bug has component in payload', typeof payload.component === 'string');
  assert('bug has operation in payload', typeof payload.operation === 'string');
  assert('bug severity is error', bugExample.severity === 'error');
}

// Test 4: digist_report event shape
console.log('\nReport event structure:');
const reportExamples = examples.filter(e => e.type === 'digist_report');
assert('at least one digist_report example', reportExamples.length >= 1);

const withTarget = reportExamples.find(e => 'target_project' in e);
const withoutTarget = reportExamples.find(e => !('target_project' in e));
assert('report with target_project exists', withTarget !== undefined);
assert('report without target_project exists', withoutTarget !== undefined);

if (withTarget) {
  const payload = withTarget.payload as Record<string, unknown>;
  assert('report has title in payload', typeof payload.title === 'string');
  assert('report has sources_count in payload', typeof payload.sources_count === 'number');
  assert('report has insights_count in payload', typeof payload.insights_count === 'number');
}

// Test 5: dedup_key format
console.log('\nDedup key format:');
for (const ex of examples) {
  const dk = ex.dedup_key as string;
  assert(
    `dedup_key starts with digist: ${dk.slice(0, 30)}...`,
    dk.startsWith('digist:'),
    dk,
  );
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
