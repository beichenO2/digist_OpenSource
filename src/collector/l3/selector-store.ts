/**
 * Persistent selector store for the L3 self-healing loop.
 *
 * Learned selectors survive restarts as JSON under data/selector-config/, so a
 * one-time LLM heal keeps paying off (no LLM call on the fast path). Mirrors the
 * existing cookie-cache convention rather than adding a SQLite column.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SelectorSet } from './types.js';

const STORE_DIR = process.env.DIGIST_SELECTOR_DIR || './data/selector-config';

function pathFor(platform: string): string {
  return join(STORE_DIR, `${platform}.json`);
}

export function loadSelectors(platform: string): SelectorSet | null {
  const p = pathFor(platform);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as SelectorSet;
    if (parsed && typeof parsed.item === 'string' && typeof parsed.title === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSelectors(platform: string, set: SelectorSet): void {
  mkdirSync(STORE_DIR, { recursive: true });
  const withMeta: SelectorSet = {
    ...set,
    learnedAt: set.learnedAt ?? new Date().toISOString(),
    source: set.source ?? 'llm-healed',
  };
  writeFileSync(pathFor(platform), JSON.stringify(withMeta, null, 2));
}
