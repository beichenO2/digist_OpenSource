import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { ContentItem, ScrapeJob, ScrapeCursor } from '../types/index.js';

/** Row shape for `source_configs` (Bilibili/YouTube etc. source configuration). */
export interface SourceConfig {
  id: string;
  platform: string;
  source_type: 'followed_creator' | 'keyword_hot' | 'keyword_latest' | 'big_hot';
  identifier: string;
  display_name: string | null;
  download_strategy: 'subtitle_only' | 'audio_asr' | 'full_video' | 'auto';
  auto_compile: boolean;
  max_items: number;
  schedule: string | null;
  enabled: boolean;
  user_id: string;
  created_at: string | null;
  updated_at: string | null;
}

/** Row shape for `feedbacks` (user feedback on recommended items). */
export interface Feedback {
  id: string;
  item_id: string;
  action: 'not_interested' | 'archive' | 'ingest';
  reason: string | null;
  note: string | null;
  user_id: string;
  created_at: string | null;
}

/** Row shape for `interests` (platforms JSON array string). */
export interface Interest {
  id: string;
  user_id: string;
  label: string;
  query: string | null;
  platforms: string[];
  enabled: boolean;
  schedule: string | null;
  linked_topic: string | null;
  auto_sync: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** Row shape for `sources` (metadata JSON object string in DB). */
export interface Source {
  id: string;
  name: string;
  kind: string | null;
  endpoint: string | null;
  metadata: Record<string, unknown>;
  enabled: boolean;
  created_at: string | null;
}

/** Row shape for `interest_sources` (FK rows joined to `interests` for reads). */
export interface InterestSourceLink {
  interest_id: string;
  source_id: string;
  weight: number;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS content_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL,
    source_url TEXT NOT NULL,
    platform TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    raw_metadata TEXT NOT NULL DEFAULT '{}',
    scraped_at TEXT NOT NULL,
    url_hash TEXT NOT NULL UNIQUE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_content_platform ON content_items(platform)`,
  `CREATE INDEX IF NOT EXISTS idx_content_timestamp ON content_items(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_content_url_hash ON content_items(url_hash)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(title, body_markdown, content=content_items, content_rowid=rowid)`,
  `CREATE TABLE IF NOT EXISTS scrape_jobs (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    query TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_cursor TEXT,
    last_run_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scrape_cursors (
    job_id TEXT NOT NULL,
    cursor_key TEXT NOT NULL,
    cursor_value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (job_id, cursor_key),
    FOREIGN KEY (job_id) REFERENCES scrape_jobs(id)
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    params TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)`,
  `CREATE TABLE IF NOT EXISTS interests (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    query TEXT,
    platforms TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT,
    endpoint TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS interest_sources (
    interest_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    created_at TEXT,
    PRIMARY KEY (interest_id, source_id),
    FOREIGN KEY (interest_id) REFERENCES interests(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
  )`,
];

const COLUMN_MIGRATIONS: Array<{ table: string; column: string; sql: string }> = [
  { table: 'interests', column: 'schedule', sql: `ALTER TABLE interests ADD COLUMN schedule TEXT DEFAULT '0 8,11,14,17,20,23 * * *'` },
  { table: 'interests', column: 'linked_topic', sql: `ALTER TABLE interests ADD COLUMN linked_topic TEXT` },
  { table: 'interests', column: 'auto_sync', sql: `ALTER TABLE interests ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 0` },
  { table: 'interests', column: 'updated_at', sql: `ALTER TABLE interests ADD COLUMN updated_at TEXT` },
  { table: 'sources', column: 'enabled', sql: `ALTER TABLE sources ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1` },
  { table: 'content_items', column: 'interest_id', sql: `ALTER TABLE content_items ADD COLUMN interest_id TEXT` },
  { table: 'interests', column: 'user_id', sql: `ALTER TABLE interests ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'` },
  { table: 'sources', column: 'user_id', sql: `ALTER TABLE sources ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'` },
  { table: 'content_items', column: 'source_type', sql: `ALTER TABLE content_items ADD COLUMN source_type TEXT DEFAULT 'api_crawl'` },
  { table: 'content_items', column: 'digest_status', sql: `ALTER TABLE content_items ADD COLUMN digest_status TEXT DEFAULT 'collected'` },
  { table: 'content_items', column: 'media_status', sql: `ALTER TABLE content_items ADD COLUMN media_status TEXT` },
  { table: 'content_items', column: 'local_play_url', sql: `ALTER TABLE content_items ADD COLUMN local_play_url TEXT` },
  { table: 'content_items', column: 'temp_doc_id', sql: `ALTER TABLE content_items ADD COLUMN temp_doc_id TEXT` },
  { table: 'content_items', column: 'content_type', sql: `ALTER TABLE content_items ADD COLUMN content_type TEXT DEFAULT 'text'` },
];

const TABLE_MIGRATIONS_V2 = [
  `CREATE TABLE IF NOT EXISTS source_configs (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('followed_creator','keyword_hot','keyword_latest','big_hot')),
    identifier TEXT NOT NULL,
    display_name TEXT,
    download_strategy TEXT NOT NULL DEFAULT 'auto' CHECK(download_strategy IN ('subtitle_only','audio_asr','full_video','auto')),
    auto_compile INTEGER NOT NULL DEFAULT 1,
    max_items INTEGER NOT NULL DEFAULT 20,
    schedule TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    user_id TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_configs_platform ON source_configs(platform)`,
  `CREATE INDEX IF NOT EXISTS idx_source_configs_user ON source_configs(user_id)`,
  `CREATE TABLE IF NOT EXISTS feedbacks (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('not_interested','archive','ingest')),
    reason TEXT,
    note TEXT,
    user_id TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES content_items(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedbacks_item ON feedbacks(item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_feedbacks_user ON feedbacks(user_id)`,
];

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string = './data/digist.sqlite') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('BEGIN');
    try {
      for (const sql of MIGRATIONS) {
        this.db.exec(sql);
      }
      for (const m of COLUMN_MIGRATIONS) {
        const cols = this.db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
        if (!cols.some(c => c.name === m.column)) {
          this.db.exec(m.sql);
        }
      }
      for (const sql of TABLE_MIGRATIONS_V2) {
        this.db.exec(sql);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private urlHash(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  // Content Items

  insertContent(item: Omit<ContentItem, 'id' | 'scraped_at'>): ContentItem | null {
    const hash = this.urlHash(item.source_url);
    const existing = this.db.prepare('SELECT id FROM content_items WHERE url_hash = ?').get(hash);
    if (existing) return null; // deduplicated

    const full: ContentItem = {
      ...item,
      id: nanoid(),
      scraped_at: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO content_items (id, title, body_markdown, author, timestamp, source_url, platform, tags, raw_metadata, scraped_at, url_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id, full.title, full.body_markdown, full.author,
      full.timestamp, full.source_url, full.platform,
      JSON.stringify(full.tags), JSON.stringify(full.raw_metadata),
      full.scraped_at, hash,
    );

    // Update FTS
    this.db.prepare(`
      INSERT INTO content_fts(rowid, title, body_markdown)
      SELECT rowid, title, body_markdown FROM content_items WHERE id = ?
    `).run(full.id);

    return full;
  }

  insertBatch(items: Omit<ContentItem, 'id' | 'scraped_at'>[]): ContentItem[] {
    const results: ContentItem[] = [];
    const txn = this.db.transaction(() => {
      for (const item of items) {
        const result = this.insertContent(item);
        if (result) results.push(result);
      }
    });
    txn();
    return results;
  }

  getContent(id: string): ContentItem | null {
    const row = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(id) as any;
    return row ? this.rowToContentItem(row) : null;
  }

  searchContent(query: string, limit = 50): ContentItem[] {
    const rows = this.db.prepare(`
      SELECT c.* FROM content_items c
      JOIN content_fts f ON c.rowid = f.rowid
      WHERE content_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as any[];
    return rows.map(r => this.rowToContentItem(r));
  }

  listContent(platform?: string, limit = 100, offset = 0): ContentItem[] {
    let sql = 'SELECT * FROM content_items';
    const params: any[] = [];
    if (platform) {
      sql += ' WHERE platform = ?';
      params.push(platform);
    }
    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToContentItem(r));
  }

  queryContent(opts: { platform?: string; since?: string; limit?: number; offset?: number }): { items: ContentItem[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];
    if (opts.platform) { conditions.push('platform = ?'); params.push(opts.platform); }
    if (opts.since) { conditions.push('scraped_at > ?'); params.push(opts.since); }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM content_items${where}`).get(...params) as any;

    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = opts.offset ?? 0;
    const rows = this.db.prepare(
      `SELECT * FROM content_items${where} ORDER BY scraped_at ASC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    return { items: rows.map(r => this.rowToContentItem(r)), total: countRow.cnt };
  }

  contentCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM content_items').get() as any;
    return row.cnt;
  }

  private rowToContentItem(row: any): ContentItem {
    return {
      ...row,
      tags: JSON.parse(row.tags),
      raw_metadata: JSON.parse(row.raw_metadata),
    };
  }

  // Scrape Jobs

  createJob(job: Omit<ScrapeJob, 'id' | 'created_at' | 'last_cursor' | 'last_run_at'>): ScrapeJob {
    const full: ScrapeJob = {
      ...job,
      id: nanoid(),
      last_cursor: null,
      last_run_at: null,
      created_at: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO scrape_jobs (id, platform, query, cron_expression, enabled, last_cursor, last_run_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(full.id, full.platform, full.query, full.cron_expression, full.enabled ? 1 : 0, full.last_cursor, full.last_run_at, full.created_at);
    return full;
  }

  getJob(id: string): ScrapeJob | null {
    const row = this.db.prepare('SELECT * FROM scrape_jobs WHERE id = ?').get(id) as any;
    return row ? { ...row, enabled: !!row.enabled } : null;
  }

  listJobs(enabledOnly = false): ScrapeJob[] {
    let sql = 'SELECT * FROM scrape_jobs';
    if (enabledOnly) sql += ' WHERE enabled = 1';
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all() as any[];
    return rows.map(r => ({ ...r, enabled: !!r.enabled }));
  }

  updateJobCursor(jobId: string, cursor: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE scrape_jobs SET last_cursor = ?, last_run_at = ? WHERE id = ?')
      .run(cursor, now, jobId);
  }

  toggleJob(jobId: string, enabled: boolean): void {
    this.db.prepare('UPDATE scrape_jobs SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, jobId);
  }

  deleteJob(jobId: string): void {
    this.db.prepare('DELETE FROM scrape_cursors WHERE job_id = ?').run(jobId);
    this.db.prepare('DELETE FROM scrape_jobs WHERE id = ?').run(jobId);
  }

  // Tasks

  createTask(type: string, params: Record<string, unknown> = {}): { id: string; type: string; status: string; params: Record<string, unknown>; created_at: string } {
    const task = {
      id: nanoid(),
      type,
      status: 'queued',
      params,
      created_at: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO tasks (id, type, status, params, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(task.id, task.type, task.status, JSON.stringify(task.params), task.created_at);
    return task;
  }

  updateTask(id: string, update: { status?: string; result?: unknown; error?: string }): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (update.status) { sets.push('status = ?'); vals.push(update.status); }
    if (update.result !== undefined) { sets.push('result = ?'); vals.push(JSON.stringify(update.result)); }
    if (update.error !== undefined) { sets.push('error = ?'); vals.push(update.error); }
    if (update.status === 'done' || update.status === 'failed') {
      sets.push('completed_at = ?'); vals.push(new Date().toISOString());
    }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  getTask(id: string): any {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, params: JSON.parse(row.params || '{}'), result: row.result ? JSON.parse(row.result) : null };
  }

  listTasks(limit = 50): any[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    return rows.map(r => ({ ...r, params: JSON.parse(r.params || '{}'), result: r.result ? JSON.parse(r.result) : null }));
  }

  // Cursors

  setCursor(jobId: string, key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO scrape_cursors (job_id, cursor_key, cursor_value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(job_id, cursor_key) DO UPDATE SET cursor_value = ?, updated_at = ?
    `).run(jobId, key, value, new Date().toISOString(), value, new Date().toISOString());
  }

  getCursor(jobId: string, key: string): string | null {
    const row = this.db.prepare('SELECT cursor_value FROM scrape_cursors WHERE job_id = ? AND cursor_key = ?')
      .get(jobId, key) as any;
    return row?.cursor_value ?? null;
  }

  /** Lists crawl interests, optionally filtered by user_id. */
  listInterests(userId?: string): Interest[] {
    if (userId) {
      const rows = this.db.prepare('SELECT * FROM interests WHERE user_id = ? ORDER BY label COLLATE NOCASE').all(userId) as any[];
      return rows.map(r => this.rowToInterest(r));
    }
    const rows = this.db.prepare('SELECT * FROM interests ORDER BY label COLLATE NOCASE').all() as any[];
    return rows.map(r => this.rowToInterest(r));
  }

  private rowToInterest(r: any): Interest {
    return {
      id: r.id,
      user_id: r.user_id ?? 'admin',
      label: r.label,
      query: r.query ?? null,
      platforms: JSON.parse(r.platforms || '[]') as string[],
      enabled: !!r.enabled,
      schedule: r.schedule ?? null,
      linked_topic: r.linked_topic ?? null,
      auto_sync: !!r.auto_sync,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
    };
  }

  getInterest(id: string): Interest | null {
    const r = this.db.prepare('SELECT * FROM interests WHERE id = ?').get(id) as any;
    return r ? this.rowToInterest(r) : null;
  }

  createInterest(input: {
    id?: string;
    user_id?: string;
    label: string;
    query?: string | null;
    platforms?: string[];
    schedule?: string | null;
    linked_topic?: string | null;
    auto_sync?: boolean;
  }): Interest {
    const id = input.id ?? nanoid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO interests (id, user_id, label, query, platforms, enabled, schedule, linked_topic, auto_sync, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.user_id ?? 'admin',
      input.label,
      input.query ?? null,
      JSON.stringify(input.platforms ?? []),
      input.schedule ?? '0 8,11,14,17,20,23 * * *',
      input.linked_topic ?? null,
      input.auto_sync ? 1 : 0,
      now,
      now,
    );
    return this.getInterest(id)!;
  }

  updateInterest(id: string, update: {
    label?: string;
    query?: string | null;
    platforms?: string[];
    enabled?: boolean;
    schedule?: string | null;
    linked_topic?: string | null;
    auto_sync?: boolean;
  }): Interest | null {
    const sets: string[] = [];
    const vals: any[] = [];
    if (update.label !== undefined) { sets.push('label = ?'); vals.push(update.label); }
    if (update.query !== undefined) { sets.push('query = ?'); vals.push(update.query); }
    if (update.platforms !== undefined) { sets.push('platforms = ?'); vals.push(JSON.stringify(update.platforms)); }
    if (update.enabled !== undefined) { sets.push('enabled = ?'); vals.push(update.enabled ? 1 : 0); }
    if (update.schedule !== undefined) { sets.push('schedule = ?'); vals.push(update.schedule); }
    if (update.linked_topic !== undefined) { sets.push('linked_topic = ?'); vals.push(update.linked_topic); }
    if (update.auto_sync !== undefined) { sets.push('auto_sync = ?'); vals.push(update.auto_sync ? 1 : 0); }
    if (sets.length === 0) return this.getInterest(id);
    sets.push('updated_at = ?'); vals.push(new Date().toISOString());
    vals.push(id);
    this.db.prepare(`UPDATE interests SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getInterest(id);
  }

  deleteInterest(id: string): boolean {
    const changes = this.db.prepare('DELETE FROM interests WHERE id = ?').run(id).changes;
    return changes > 0;
  }

  /** Link an interest to a source with optional weight. */
  linkInterestSource(interestId: string, sourceId: string, weight = 1): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO interest_sources (interest_id, source_id, weight, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(interest_id, source_id) DO UPDATE SET weight = ?
    `).run(interestId, sourceId, weight, now, weight);
  }

  unlinkInterestSource(interestId: string, sourceId: string): boolean {
    return this.db.prepare('DELETE FROM interest_sources WHERE interest_id = ? AND source_id = ?')
      .run(interestId, sourceId).changes > 0;
  }

  deleteSource(id: string): boolean {
    const changes = this.db.prepare('DELETE FROM sources WHERE id = ?').run(id).changes;
    return changes > 0;
  }

  /** Insert or update a catalog source by `id` (generates id when omitted). */
  upsertSource(input: {
    id?: string;
    name: string;
    kind?: string | null;
    endpoint?: string | null;
    metadata?: Record<string, unknown>;
  }): Source {
    const id = input.id ?? nanoid();
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT id FROM sources WHERE id = ?').get(id) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE sources SET name = ?, kind = ?, endpoint = ?, metadata = ?
        WHERE id = ?
      `).run(input.name, input.kind ?? null, input.endpoint ?? null, metadataJson, id);
    } else {
      this.db.prepare(`
        INSERT INTO sources (id, name, kind, endpoint, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.kind ?? null, input.endpoint ?? null, metadataJson, now);
    }
    return this.getSourceById(id)!;
  }

  private getSourceById(id: string): Source | null {
    const r = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind ?? null,
      endpoint: r.endpoint ?? null,
      metadata: JSON.parse(r.metadata || '{}') as Record<string, unknown>,
      enabled: r.enabled === undefined ? true : !!r.enabled,
      created_at: r.created_at ?? null,
    };
  }

  /** Lists catalog sources, optionally filtered by user_id. */
  listSources(userId?: string): Source[] {
    const sql = userId
      ? 'SELECT * FROM sources WHERE user_id = ? ORDER BY name COLLATE NOCASE'
      : 'SELECT * FROM sources ORDER BY name COLLATE NOCASE';
    const rows = (userId
      ? this.db.prepare(sql).all(userId)
      : this.db.prepare(sql).all()) as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      kind: r.kind ?? null,
      endpoint: r.endpoint ?? null,
      metadata: JSON.parse(r.metadata || '{}') as Record<string, unknown>,
      enabled: r.enabled === undefined ? true : !!r.enabled,
      created_at: r.created_at ?? null,
    }));
  }

  /**
   * Lists interest↔source links (`interest_id`, `source_id`, `weight`).
   * Joins `interests` so ordering is stable and orphan links are excluded if FKs were off historically.
   */
  listInterestSourceLinks(): InterestSourceLink[] {
    const rows = this.db
      .prepare(
        `SELECT isl.interest_id, isl.source_id, isl.weight
         FROM interest_sources isl
         INNER JOIN interests i ON i.id = isl.interest_id
         ORDER BY i.label COLLATE NOCASE, isl.source_id`,
      )
      .all() as any[];
    return rows.map(r => ({
      interest_id: r.interest_id,
      source_id: r.source_id,
      weight: Number(r.weight),
    }));
  }

  // SourceConfig CRUD

  createSourceConfig(input: {
    id?: string;
    platform: string;
    source_type: SourceConfig['source_type'];
    identifier: string;
    display_name?: string | null;
    download_strategy?: SourceConfig['download_strategy'];
    auto_compile?: boolean;
    max_items?: number;
    schedule?: string | null;
    enabled?: boolean;
    user_id?: string;
  }): SourceConfig {
    const id = input.id ?? nanoid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO source_configs (id, platform, source_type, identifier, display_name, download_strategy, auto_compile, max_items, schedule, enabled, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.platform, input.source_type, input.identifier,
      input.display_name ?? null,
      input.download_strategy ?? 'auto',
      (input.auto_compile ?? true) ? 1 : 0,
      input.max_items ?? 20,
      input.schedule ?? null,
      (input.enabled ?? true) ? 1 : 0,
      input.user_id ?? 'admin',
      now, now,
    );
    return this.getSourceConfig(id)!;
  }

  getSourceConfig(id: string): SourceConfig | null {
    const r = this.db.prepare('SELECT * FROM source_configs WHERE id = ?').get(id) as any;
    return r ? this.rowToSourceConfig(r) : null;
  }

  listSourceConfigs(userId?: string, platform?: string): SourceConfig[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (userId) { conditions.push('user_id = ?'); params.push(userId); }
    if (platform) { conditions.push('platform = ?'); params.push(platform); }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT * FROM source_configs${where} ORDER BY created_at DESC`).all(...params) as any[];
    return rows.map(r => this.rowToSourceConfig(r));
  }

  updateSourceConfig(id: string, update: {
    platform?: string;
    source_type?: SourceConfig['source_type'];
    identifier?: string;
    display_name?: string | null;
    download_strategy?: SourceConfig['download_strategy'];
    auto_compile?: boolean;
    max_items?: number;
    schedule?: string | null;
    enabled?: boolean;
  }): SourceConfig | null {
    const sets: string[] = [];
    const vals: any[] = [];
    if (update.platform !== undefined) { sets.push('platform = ?'); vals.push(update.platform); }
    if (update.source_type !== undefined) { sets.push('source_type = ?'); vals.push(update.source_type); }
    if (update.identifier !== undefined) { sets.push('identifier = ?'); vals.push(update.identifier); }
    if (update.display_name !== undefined) { sets.push('display_name = ?'); vals.push(update.display_name); }
    if (update.download_strategy !== undefined) { sets.push('download_strategy = ?'); vals.push(update.download_strategy); }
    if (update.auto_compile !== undefined) { sets.push('auto_compile = ?'); vals.push(update.auto_compile ? 1 : 0); }
    if (update.max_items !== undefined) { sets.push('max_items = ?'); vals.push(update.max_items); }
    if (update.schedule !== undefined) { sets.push('schedule = ?'); vals.push(update.schedule); }
    if (update.enabled !== undefined) { sets.push('enabled = ?'); vals.push(update.enabled ? 1 : 0); }
    if (sets.length === 0) return this.getSourceConfig(id);
    sets.push('updated_at = ?'); vals.push(new Date().toISOString());
    vals.push(id);
    this.db.prepare(`UPDATE source_configs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getSourceConfig(id);
  }

  deleteSourceConfig(id: string): boolean {
    return this.db.prepare('DELETE FROM source_configs WHERE id = ?').run(id).changes > 0;
  }

  private rowToSourceConfig(r: any): SourceConfig {
    return {
      id: r.id,
      platform: r.platform,
      source_type: r.source_type,
      identifier: r.identifier,
      display_name: r.display_name ?? null,
      download_strategy: r.download_strategy ?? 'auto',
      auto_compile: !!r.auto_compile,
      max_items: r.max_items ?? 20,
      schedule: r.schedule ?? null,
      enabled: !!r.enabled,
      user_id: r.user_id ?? 'admin',
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
    };
  }

  // Feedback CRUD

  createFeedback(input: {
    id?: string;
    item_id: string;
    action: Feedback['action'];
    reason?: string | null;
    note?: string | null;
    user_id?: string;
  }): Feedback {
    const id = input.id ?? nanoid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO feedbacks (id, item_id, action, reason, note, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.item_id, input.action, input.reason ?? null, input.note ?? null, input.user_id ?? 'admin', now);
    return this.getFeedback(id)!;
  }

  getFeedback(id: string): Feedback | null {
    const r = this.db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id) as any;
    return r ? this.rowToFeedback(r) : null;
  }

  listFeedbacks(opts?: { userId?: string; itemId?: string; action?: string }): Feedback[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (opts?.userId) { conditions.push('user_id = ?'); params.push(opts.userId); }
    if (opts?.itemId) { conditions.push('item_id = ?'); params.push(opts.itemId); }
    if (opts?.action) { conditions.push('action = ?'); params.push(opts.action); }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT * FROM feedbacks${where} ORDER BY created_at DESC`).all(...params) as any[];
    return rows.map(r => this.rowToFeedback(r));
  }

  getFeedbackForItems(itemIds: string[]): Map<string, Feedback[]> {
    const result = new Map<string, Feedback[]>();
    if (itemIds.length === 0) return result;
    const placeholders = itemIds.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM feedbacks WHERE item_id IN (${placeholders}) ORDER BY created_at DESC`
    ).all(...itemIds) as any[];
    for (const r of rows) {
      const fb = this.rowToFeedback(r);
      const list = result.get(fb.item_id) || [];
      list.push(fb);
      result.set(fb.item_id, list);
    }
    return result;
  }

  private rowToFeedback(r: any): Feedback {
    return {
      id: r.id,
      item_id: r.item_id,
      action: r.action,
      reason: r.reason ?? null,
      note: r.note ?? null,
      user_id: r.user_id ?? 'admin',
      created_at: r.created_at ?? null,
    };
  }

  // Content status updates

  updateContentStatus(id: string, update: {
    digest_status?: string;
    media_status?: string;
    local_play_url?: string | null;
    temp_doc_id?: string | null;
    content_type?: string;
    source_type?: string;
  }): boolean {
    const sets: string[] = [];
    const vals: any[] = [];
    if (update.digest_status !== undefined) { sets.push('digest_status = ?'); vals.push(update.digest_status); }
    if (update.media_status !== undefined) { sets.push('media_status = ?'); vals.push(update.media_status); }
    if (update.local_play_url !== undefined) { sets.push('local_play_url = ?'); vals.push(update.local_play_url); }
    if (update.temp_doc_id !== undefined) { sets.push('temp_doc_id = ?'); vals.push(update.temp_doc_id); }
    if (update.content_type !== undefined) { sets.push('content_type = ?'); vals.push(update.content_type); }
    if (update.source_type !== undefined) { sets.push('source_type = ?'); vals.push(update.source_type); }
    if (sets.length === 0) return false;
    vals.push(id);
    return this.db.prepare(`UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
