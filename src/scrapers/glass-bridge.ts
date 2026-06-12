import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const GLASS_DB_PATHS = [
  join(homedir(), 'Library/Application Support/pickle-glass/glass.db'),
  join(homedir(), 'Library/Application Support/pickle-glass/memory.db'),
  join(homedir(), '.pickle-glass/glass.db'),
];

function findGlassDb(): string | null {
  for (const p of GLASS_DB_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function extractScreenRecords(db: Database.Database, query: string, limit: number): ContentItem[] {
  const items: ContentItem[] = [];

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tableNames = tables.map(t => t.name);

  // Glass stores screen captures and OCR text in various tables
  for (const tableName of tableNames) {
    if (tableName.startsWith('sqlite_') || tableName === 'migrations') continue;

    try {
      const cols = db.pragma(`table_info(${tableName})`) as { name: string }[];
      const colNames = cols.map(c => c.name);

      const textCols = colNames.filter(c =>
        /text|content|title|summary|description|ocr|transcript/i.test(c)
      );
      if (textCols.length === 0) continue;

      const timeCols = colNames.filter(c =>
        /time|date|created|updated|timestamp/i.test(c)
      );
      const timeCol = timeCols[0] || null;

      const selectCols = [...textCols, ...(timeCol ? [timeCol] : [])].join(', ');
      let sql = `SELECT ${selectCols} FROM ${tableName}`;

      if (query && textCols.length > 0) {
        const conditions = textCols.map(c => `${c} LIKE ?`).join(' OR ');
        sql += ` WHERE ${conditions}`;
      }

      if (timeCol) sql += ` ORDER BY ${timeCol} DESC`;
      sql += ` LIMIT ?`;

      const params: any[] = [];
      if (query) {
        for (const _ of textCols) params.push(`%${query}%`);
      }
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as Record<string, any>[];

      for (const row of rows) {
        const bodyParts: string[] = [];
        for (const col of textCols) {
          if (row[col] && typeof row[col] === 'string' && row[col].length > 5) {
            bodyParts.push(`**${col}**: ${row[col]}`);
          }
        }
        if (bodyParts.length === 0) continue;

        const bodyMd = bodyParts.join('\n\n');
        const fingerprint = createHash('sha256').update(`${tableName}|${bodyMd}`).digest('hex').slice(0, 32);

        const timestamp = timeCol && row[timeCol]
          ? new Date(typeof row[timeCol] === 'number' ? row[timeCol] * 1000 : row[timeCol]).toISOString()
          : new Date().toISOString();

        items.push({
          id: '',
          title: `[Glass/${tableName}] ${bodyParts[0]?.slice(0, 80) || 'Screen capture'}`,
          body_markdown: bodyMd,
          author: 'glass-local',
          timestamp,
          source_url: `glass://record/${tableName}/${fingerprint}`,
          platform: 'glass',
          tags: ['glass', 'screen-capture', tableName],
          raw_metadata: { table: tableName, source: 'glass-bridge' },
          scraped_at: new Date().toISOString(),
        });
      }
    } catch {
      // Table schema mismatch, skip
    }
  }

  return items;
}

export const glassBridgeScraper: Scraper = {
  name: 'glass-bridge',
  platform: 'other',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 50;
    const dbPath = findGlassDb();

    if (!dbPath) {
      console.log('[Glass Bridge] Glass database not found. Is Glass installed and running?');
      return { items: [], next_cursor: null, has_more: false };
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const items = extractScreenRecords(db, query, maxItems);
      return {
        items,
        next_cursor: null,
        has_more: items.length >= maxItems,
      };
    } finally {
      db.close();
    }
  },
};

export function getGlassStatus(): { installed: boolean; dbPath: string | null; dbSize: number } {
  const dbPath = findGlassDb();
  if (!dbPath) return { installed: false, dbPath: null, dbSize: 0 };

  try {
    const { statSync } = require('fs');
    const stat = statSync(dbPath);
    return { installed: true, dbPath, dbSize: stat.size };
  } catch {
    return { installed: true, dbPath, dbSize: 0 };
  }
}
