/**
 * Sync DiGist daily digest to KnowLever, organized by domain topics.
 * 
 * Structure: KnowLever/data/users/admin/topics/digist-<domain>/raw/<date>.md
 * 
 * Tracks pushed dates in data/knowlever-sync-state.json to prevent duplicates.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const KNOWLEVER_BASE = process.env.KNOWLEVER_DATA
  || join(process.env.HOME ?? '~', 'Polarisor/KnowLever/data');
const DIGEST_BASE = './data/daily';
const SYNC_STATE_FILE = './data/knowlever-sync-state.json';
const DIGIST_TIME_ZONE = process.env.DIGIST_TIME_ZONE || 'Asia/Shanghai';

function resolveUsers(): string[] {
  const envUsers = process.env.DIGIST_SYNC_USERS;
  if (envUsers) return envUsers.split(',').map(u => u.trim()).filter(Boolean);
  return ['admin'];
}

const DOMAIN_TOPIC_MAP: Record<string, string> = {
  '加密货币 & Web3': 'digist-crypto',
  '量化交易': 'digist-quant',
  '金融 & 经济': 'digist-finance',
  'AI 科研前沿': 'digist-ai-research',
  'AI 应用前沿': 'digist-ai-app',
  '其他': 'digist-general',
};

const KNOWN_DOMAINS = new Set(Object.keys(DOMAIN_TOPIC_MAP));

interface SyncState {
  lastSynced: Record<string, string[]>; // topic -> [date1, date2, ...]
  entries?: Record<string, SyncEntry[]>;
}

interface SyncEntry {
  date: string;
  hash: string;
  syncedAt: string;
  status: 'complete' | 'fallback';
}

function loadState(): SyncState {
  if (existsSync(SYNC_STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(SYNC_STATE_FILE, 'utf-8'));
    } catch { /* corrupted, reset */ }
  }
  return { lastSynced: {} };
}

function saveState(state: SyncState): void {
  writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

function splitDigestByDomain(digestContent: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = digestContent.split('\n');

  let currentDomain = '';
  let currentLines: string[] = [];
  let headerLines: string[] = [];
  let inHeader = true;

  for (const line of lines) {
    if (inHeader) {
      headerLines.push(line);
      if (line.startsWith('> 总计:')) {
        inHeader = false;
      }
      continue;
    }

    const domainMatch = line.match(/^## (.+)$/);
    if (domainMatch && KNOWN_DOMAINS.has(domainMatch[1])) {
      if (currentDomain && currentLines.length > 0) {
        sections[currentDomain] = [...headerLines, '', ...currentLines].join('\n').trim();
      }
      currentDomain = domainMatch[1];
      currentLines = [`## ${currentDomain}`, ''];
      continue;
    }
    if (domainMatch && domainMatch[1] === '信息来源') {
      if (currentDomain && currentLines.length > 0) {
        sections[currentDomain] = [...headerLines, '', ...currentLines].join('\n').trim();
      }
      currentDomain = '';
      currentLines = [];
      continue;
    }

    if (line === '---' && currentDomain) {
      sections[currentDomain] = [...headerLines, '', ...currentLines].join('\n').trim();
      currentDomain = '';
      currentLines = [];
      continue;
    }

    if (currentDomain) {
      currentLines.push(line);
    }
  }

  if (currentDomain && currentLines.length > 0) {
    sections[currentDomain] = [...headerLines, '', ...currentLines].join('\n').trim();
  }

  return sections;
}

function pushToKnowLever(topic: string, date: string, content: string, user: string): string {
  const rawDir = join(KNOWLEVER_BASE, 'users', user, 'topics', topic, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const filename = `${date}-digest.md`;
  const dest = join(rawDir, filename);
  writeFileSync(dest, content);
  return dest;
}

function localDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DIGIST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function resolveTargetDate(): string {
  const argDate = process.argv[2] || process.env.DIGIST_DAILY_DATE || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(argDate)) return argDate;
  return localDateString();
}

function digestHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function contentStatus(content: string): SyncEntry['status'] {
  return /LLM 总结暂不可用|总结生成失败|不可用，仅列出标题/.test(content)
    ? 'fallback'
    : 'complete';
}

function findSyncedEntry(state: SyncState, topic: string, date: string): SyncEntry | undefined {
  return state.entries?.[topic]?.find(entry => entry.date === date);
}

function rawDigestPath(topic: string, date: string, user: string): string {
  return join(KNOWLEVER_BASE, 'users', user, 'topics', topic, 'raw', `${date}-digest.md`);
}

function isUnchanged(state: SyncState, topic: string, date: string, hash: string, user: string): boolean {
  const stateKey = `${user}:${topic}`;
  const entry = findSyncedEntry(state, stateKey, date);
  if (entry?.hash === hash) return true;

  const legacyEntry = findSyncedEntry(state, topic, date);
  if (legacyEntry?.hash === hash) return true;

  if (state.lastSynced[stateKey]?.includes(date) || state.lastSynced[topic]?.includes(date)) {
    const existingPath = rawDigestPath(topic, date, user);
    if (existsSync(existingPath)) {
      return digestHash(readFileSync(existingPath, 'utf-8')) === hash;
    }
  }

  return false;
}

function markSynced(state: SyncState, topic: string, date: string, content: string): void {
  if (!state.lastSynced[topic]) state.lastSynced[topic] = [];
  if (!state.lastSynced[topic].includes(date)) state.lastSynced[topic].push(date);

  const MAX_HISTORY = 90;
  if (state.lastSynced[topic].length > MAX_HISTORY) {
    state.lastSynced[topic] = state.lastSynced[topic].slice(-MAX_HISTORY);
  }

  state.entries ??= {};
  const entries = state.entries[topic] ?? [];
  const nextEntry: SyncEntry = {
    date,
    hash: digestHash(content),
    syncedAt: new Date().toISOString(),
    status: contentStatus(content),
  };
  const existingIndex = entries.findIndex(entry => entry.date === date);
  if (existingIndex >= 0) {
    entries[existingIndex] = nextEntry;
  } else {
    entries.push(nextEntry);
  }
  state.entries[topic] = entries.slice(-MAX_HISTORY);
}

function main() {
  const today = resolveTargetDate();
  const digestPath = join(DIGEST_BASE, today, 'digest.md');

  if (!existsSync(digestPath)) {
    console.error(`[KnowLever Sync] No digest found for ${today}: ${digestPath}`);
    console.error('Run: npm run summarize');
    process.exit(1);
  }

  const users = resolveUsers();
  const state = loadState();
  const digestContent = readFileSync(digestPath, 'utf-8');
  const sections = splitDigestByDomain(digestContent);

  console.log(`[KnowLever Sync] Digest ${today}: ${Object.keys(sections).length} domains → ${users.length} user(s): ${users.join(', ')}`);

  let pushed = 0;
  let skipped = 0;

  for (const user of users) {
    for (const [domain, content] of Object.entries(sections)) {
      if (domain === '信息来源') continue;

      const topic = DOMAIN_TOPIC_MAP[domain] || `digist-${domain.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
      const hash = digestHash(content);
      const alreadySynced = isUnchanged(state, topic, today, hash, user);

      if (alreadySynced) {
        console.log(`  [SKIP] ${user}/${domain} → ${topic} (unchanged for ${today})`);
        skipped++;
        continue;
      }

      const dest = pushToKnowLever(topic, today, content, user);
      console.log(`  [PUSH] ${user}/${domain} → ${dest}`);

      const stateKey = `${user}:${topic}`;
      markSynced(state, stateKey, today, content);
      pushed++;
    }
  }

  saveState(state);
  console.log(`\n[KnowLever Sync] Done: ${pushed} pushed, ${skipped} skipped`);
}

main();
