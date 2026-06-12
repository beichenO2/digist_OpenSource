import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '..', '..', 'contracts');

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

interface SchemaProperty {
  type?: string | string[];
  enum?: (string | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  required?: string[];
  properties?: Record<string, SchemaProperty>;
}

interface Schema {
  required?: string[];
  properties?: Record<string, SchemaProperty>;
}

function validateAgainstSchema(obj: Record<string, unknown>, schema: Schema): string[] {
  const errors: string[] = [];

  for (const req of schema.required || []) {
    if (!(req in obj) || obj[req] === undefined) {
      errors.push(`missing required field: ${req}`);
    }
  }

  for (const [key, prop] of Object.entries(schema.properties || {})) {
    if (!(key in obj)) continue;
    const val = obj[key];

    if (prop.type) {
      const types = Array.isArray(prop.type) ? prop.type : [prop.type];
      const actualType = val === null ? 'null' : typeof val;
      if (!types.includes(actualType) && !(types.includes('integer') && typeof val === 'number' && Number.isInteger(val))) {
        errors.push(`${key}: expected type ${types.join('|')}, got ${actualType}`);
      }
    }

    if (prop.enum && !prop.enum.includes(val as string | null)) {
      errors.push(`${key}: value "${val}" not in enum [${prop.enum.join(', ')}]`);
    }

    if (typeof val === 'number') {
      if (prop.minimum !== undefined && val < prop.minimum) errors.push(`${key}: ${val} < minimum ${prop.minimum}`);
      if (prop.maximum !== undefined && val > prop.maximum) errors.push(`${key}: ${val} > maximum ${prop.maximum}`);
    }

    if (typeof val === 'string' && prop.minLength !== undefined && val.length < prop.minLength) {
      errors.push(`${key}: length ${val.length} < minLength ${prop.minLength}`);
    }
  }

  return errors;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

console.log('\n=== Contract Tests ===\n');

// --- source-config ---
console.log('📋 source-config.schema.json');
const scSchema = loadJson(resolve(contractsDir, 'source-config.schema.json')) as Schema;
const scExamples = loadJson(resolve(contractsDir, 'examples', 'source-config.example.json')) as Record<string, unknown>[];

assert(Array.isArray(scExamples) && scExamples.length > 0, 'examples exist');

for (const [i, ex] of scExamples.entries()) {
  const errs = validateAgainstSchema(ex, scSchema);
  assert(errs.length === 0, `example[${i}] passes schema${errs.length ? ': ' + errs.join('; ') : ''}`);
}

assert(scExamples.some(e => e.source_type === 'followed_creator'), 'has followed_creator example');
assert(scExamples.some(e => e.source_type === 'keyword_hot'), 'has keyword_hot example');

// --- feedback ---
console.log('\n📋 feedback.schema.json');
const fbSchema = loadJson(resolve(contractsDir, 'feedback.schema.json')) as Schema;
const fbExamples = loadJson(resolve(contractsDir, 'examples', 'feedback.example.json')) as Record<string, unknown>[];

assert(Array.isArray(fbExamples) && fbExamples.length > 0, 'examples exist');

for (const [i, ex] of fbExamples.entries()) {
  const errs = validateAgainstSchema(ex, fbSchema);
  assert(errs.length === 0, `example[${i}] passes schema${errs.length ? ': ' + errs.join('; ') : ''}`);
}

assert(fbExamples.some(e => e.action === 'not_interested'), 'has not_interested example');
assert(fbExamples.some(e => e.action === 'ingest'), 'has ingest example');

// --- recommend-item ---
console.log('\n📋 recommend-item.schema.json');
const riSchema = loadJson(resolve(contractsDir, 'recommend-item.schema.json')) as Schema;
const riExamples = loadJson(resolve(contractsDir, 'examples', 'recommend-item.example.json')) as Record<string, unknown>[];

assert(Array.isArray(riExamples) && riExamples.length > 0, 'examples exist');

for (const [i, ex] of riExamples.entries()) {
  const errs = validateAgainstSchema(ex, riSchema);
  assert(errs.length === 0, `example[${i}] passes schema${errs.length ? ': ' + errs.join('; ') : ''}`);
}

assert(riExamples.some(e => e.source_type === 'followed_creator'), 'has followed_creator example');
assert(riExamples.some(e => e.digest_status === 'downloaded'), 'has downloaded status example');
assert(riExamples.some(e => e.media_status === 'subtitle_fetched'), 'has subtitle_fetched media status');
assert(riExamples.every(e => typeof e.content_type === 'string'), 'all have content_type');
assert(riExamples.every(e => typeof e.digest_status === 'string'), 'all have digest_status');
assert(riExamples.every(e => 'local_play_url' in e), 'all have local_play_url field');
assert(riExamples.every(e => 'watch_url' in e), 'all have watch_url field');
assert(riExamples.every(e => 'temp_doc_id' in e), 'all have temp_doc_id field');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
