/**
 * DiGist standalone orchestration HTTP API (not Next.js).
 *
 * command: npm run digist-api
 * env: DIGIST_DB (default ./data/digist.sqlite), PORT (default 3800)
 */
import http from 'node:http';
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { URL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// digist-api can be launched with a minimal PATH (e.g. via nohup/launchd) that
// lacks Homebrew / venv bin dirs, which breaks spawned tools such as yt-dlp,
// ffmpeg and ffprobe ("spawn yt-dlp ENOENT"). Prepend the common tool locations
// so child processes resolve them regardless of how the server was started.
{
  const extraDirs = [
    ...(process.env.DIGIST_TOOL_PATH?.split(':').filter(Boolean) ?? []),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    resolve(homedir(), '.agent-reach-venv', 'bin'),
  ];
  const current = (process.env.PATH ?? '').split(':');
  const missing = extraDirs.filter((d) => existsSync(d) && !current.includes(d));
  if (missing.length > 0) process.env.PATH = [...missing, ...current].filter(Boolean).join(':');
}
import { Storage } from '../storage/index.js';
import { crawl, crawlPlatforms, type CrawlPlatform } from './crawl-api.js';
import { normalizeBatch, deduplicateByUrl } from '../normalizer/index.js';
import { jsonError, jsonStdError } from './error-envelope.js';
import { getCachedDailyReport, startDailyReportCron, backgroundRefresh } from '../report/daily-report.js';
import { emitBug, getStatus, runHealthCheck, runTargetTest, type StatusDeps } from '../adapters/polarclaw/index.js';

const execAsync = promisify(execFile);

const PREFERRED_PORT = Number(process.env.PORT) || 3800;
let PORT = PREFERRED_PORT;
let cachedRecommender: any = null;
let cachedRecommenderAt = 0;
const DB_PATH = process.env.DIGIST_DB || './data/digist.sqlite';

const noQueryPlatforms = new Set<string>(['glass', 'hackernews', 'bloomberg']);

type VideoDigestJob = {
  status: 'pending' | 'running' | 'done' | 'failed';
  url: string;
  startedAt: number;
  durationSeconds?: number;
  result?: {
    title: string;
    method: string;
    duration_seconds: number;
    transcript_preview: string;
    summary_preview: string;
    has_transcript: boolean;
    has_summary: boolean;
    knowlever?: { pushed: boolean; topic: string };
  };
  error?: string;
};

const videoDigestJobs = new Map<string, VideoDigestJob>();

function videoDigestJobKey(url: string): string {
  return url.trim();
}

function pollTimeoutMs(durationSeconds?: number): number {
  const base = durationSeconds && durationSeconds > 0 ? durationSeconds : 600;
  return Math.max(120_000, base * 3 * 1000);
}

type DbMeta = {
  status: 'connected' | 'degraded';
  path: string;
  error?: string;
};

let storage: Storage | null = null;
let dbMeta: DbMeta = { status: 'degraded', path: DB_PATH };

function tryOpenStorage(): void {
  try {
    mkdirSync('./data', { recursive: true });
    const dir = dirname(DB_PATH);
    if (dir && dir !== '.') {
      mkdirSync(dir, { recursive: true });
    }
    storage = new Storage(DB_PATH);
    dbMeta = { status: 'connected', path: DB_PATH };
  } catch (err) {
    storage = null;
    dbMeta = {
      status: 'degraded',
      path: DB_PATH,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

tryOpenStorage();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const path = u.pathname;

  try {
    if (req.method === 'GET' && (path === '/health' || path === '/api/health')) {
      json(res, 200, { ok: dbMeta.status === 'connected', db: dbMeta });
      return;
    }

    if (req.method === 'GET' && path === '/api/content_items') {
      if (!storage) {
        json(res, 200, { items: [], total: 0 });
        return;
      }
      const platform = u.searchParams.get('platform') || undefined;
      const since = u.searchParams.get('since') || undefined;
      const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit')) || 100));
      const offset = Math.max(0, Number(u.searchParams.get('offset')) || 0);
      const result = storage.queryContent({ platform, since, limit, offset });
      json(res, 200, { items: result.items, total: result.total });
      return;
    }

    if (req.method === 'GET' && path === '/api/items/count') {
      if (!storage) {
        json(res, 200, { count: 0 });
        return;
      }
      json(res, 200, { count: storage.contentCount() });
      return;
    }

    if (req.method === 'GET' && path === '/api/items/recent') {
      const limitRaw = u.searchParams.get('limit');
      const limit = Math.min(
        500,
        Math.max(1, limitRaw ? Number.parseInt(limitRaw, 10) || 20 : 20),
      );
      const q = u.searchParams.get('q')?.trim();
      if (!storage) {
        json(res, 200, { items: [] });
        return;
      }
      const rows = q
        ? storage.searchContent(q, limit)
        : storage.listContent(undefined, limit, 0);
      const items = rows.map((r) => ({
        id: r.id,
        title: r.title,
        platform: r.platform,
        timestamp: r.timestamp,
        source_url: r.source_url,
      }));
      json(res, 200, q ? { items, search: q } : { items });
      return;
    }

    if (req.method === 'GET' && path === '/api/scheduler/status') {
      if (!storage) {
        json(res, 200, { jobs: [] });
        return;
      }
      const jobs = storage.listJobs().map((j) => ({
        id: j.id,
        platform: j.platform,
        query: j.query,
        cron_expression: j.cron_expression,
        enabled: j.enabled,
        last_run_at: j.last_run_at,
      }));
      json(res, 200, { jobs });
      return;
    }

    if (req.method === 'GET' && path === '/api/daily-report') {
      if (!storage) {
        json(res, 200, { date: '', totalItems: 0, clusters: [], markdown: '' });
        return;
      }
      const dateParam = u.searchParams.get('date') || undefined;
      const forceRefresh = u.searchParams.get('force') === '1';
      try {
        const report = await getCachedDailyReport(storage, dateParam, forceRefresh);
        json(res, 200, report);
      } catch (err) {
        json(res, 500, { error: String(err) });
      }
      return;
    }

    if (req.method === 'GET' && path === '/api/interests') {
      if (!storage) {
        json(res, 200, { interests: [] });
        return;
      }
      const userId = u.searchParams.get('user_id') || undefined;
      json(res, 200, { interests: storage.listInterests(userId) });
      return;
    }

    if (req.method === 'GET' && path === '/api/sources') {
      if (!storage) {
        json(res, 200, { sources: [] });
        return;
      }
      const userId = u.searchParams.get('user_id') || undefined;
      json(res, 200, { sources: storage.listSources(userId) });
      return;
    }

    if (req.method === 'GET' && path === '/api/interest-sources') {
      if (!storage) {
        json(res, 200, { links: [] });
        return;
      }
      json(res, 200, { links: storage.listInterestSourceLinks() });
      return;
    }

    // Interest CRUD
    if (req.method === 'POST' && path === '/api/interests') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const raw = await readBody(req);
      let body: { id?: string; label?: string; query?: string; platforms?: string[]; schedule?: string; linked_topic?: string; auto_sync?: boolean; user_id?: string };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.label) { jsonError(res, 400, 'LABEL_REQUIRED', 'label field is required'); return; }
      const interest = storage.createInterest({ ...body, label: body.label, user_id: body.user_id });
      json(res, 201, { interest });
      return;
    }

    if (req.method === 'PUT' && path.startsWith('/api/interests/')) {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const id = path.slice('/api/interests/'.length);
      if (!id) { jsonError(res, 400, 'ID_REQUIRED', 'Interest ID is required'); return; }
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      const updated = storage.updateInterest(id, body as any);
      if (!updated) { jsonError(res, 404, 'NOT_FOUND', `Interest ${id} not found`); return; }
      json(res, 200, { interest: updated });
      return;
    }

    if (req.method === 'DELETE' && path.startsWith('/api/interests/')) {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const id = path.slice('/api/interests/'.length);
      if (!id) { jsonError(res, 400, 'ID_REQUIRED', 'Interest ID is required'); return; }
      const deleted = storage.deleteInterest(id);
      json(res, deleted ? 200 : 404, { deleted });
      return;
    }

    // Source CRUD
    if (req.method === 'POST' && path === '/api/sources') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const raw = await readBody(req);
      let body: { id?: string; name?: string; kind?: string; endpoint?: string; metadata?: Record<string, unknown> };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.name) { jsonError(res, 400, 'NAME_REQUIRED', 'name field is required'); return; }
      const source = storage.upsertSource(body as any);
      json(res, 201, { source });
      return;
    }

    if (req.method === 'DELETE' && path.startsWith('/api/sources/')) {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const id = path.slice('/api/sources/'.length);
      if (!id) { jsonError(res, 400, 'ID_REQUIRED', 'Source ID is required'); return; }
      const deleted = storage.deleteSource(id);
      json(res, deleted ? 200 : 404, { deleted });
      return;
    }

    // Interest-Source linking
    if (req.method === 'POST' && path === '/api/interest-sources') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const raw = await readBody(req);
      let body: { interest_id?: string; source_id?: string; weight?: number };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.interest_id || !body.source_id) { jsonError(res, 400, 'MISSING_FIELDS', 'interest_id and source_id are required'); return; }
      storage.linkInterestSource(body.interest_id, body.source_id, body.weight);
      json(res, 201, { linked: true });
      return;
    }

    if (req.method === 'DELETE' && path === '/api/interest-sources') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const raw = await readBody(req);
      let body: { interest_id?: string; source_id?: string };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.interest_id || !body.source_id) { jsonError(res, 400, 'MISSING_FIELDS', 'interest_id and source_id are required'); return; }
      const unlinked = storage.unlinkInterestSource(body.interest_id, body.source_id);
      json(res, unlinked ? 200 : 404, { unlinked });
      return;
    }

    // Sync to KnowLever
    if (req.method === 'POST' && path === '/api/sync-to-knowlever') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const raw = await readBody(req);
      let body: { interest_id?: string; topic?: string; user?: string; dry_run?: boolean };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.interest_id) { jsonError(res, 400, 'INTEREST_ID_REQUIRED', 'interest_id is required'); return; }
      const interest = storage.getInterest(body.interest_id);
      if (!interest) { jsonError(res, 404, 'NOT_FOUND', `Interest ${body.interest_id} not found`); return; }
      const topic = body.topic || interest.linked_topic;
      if (!topic) { jsonError(res, 400, 'NO_LINKED_TOPIC', 'Interest has no linked_topic and none provided'); return; }

      const klRoot = resolve(process.cwd(), '..', 'KnowLever');
      const syncScript = resolve(klRoot, 'scripts', 'digest-sync.js');

      if (!existsSync(syncScript)) {
        json(res, 200, {
          status: 'ready',
          interest_id: interest.id,
          topic,
          knowlever_found: false,
          message: `KnowLever not found at ${klRoot}. SOTAgent should call: node scripts/digest-sync.js --topic ${topic} --user admin`,
        });
        return;
      }

      if (body.dry_run) {
        json(res, 200, { status: 'ready', interest_id: interest.id, topic, knowlever_found: true, dry_run: true });
        return;
      }

      try {
        const user = body.user || 'admin';
        const { stdout, stderr } = await execAsync(
          'node',
          [syncScript, '--topic', topic, '--user', user, '--db', DB_PATH],
          { cwd: klRoot, timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
        );
        json(res, 200, {
          status: 'synced',
          interest_id: interest.id,
          topic,
          stdout: stdout.trim(),
          stderr: stderr.trim() || undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, 500, 'SYNC_FAILED', msg.slice(0, 500));
        emitBug(err, { component: 'api', operation: 'sync-to-knowlever' }).catch(() => {});
      }
      return;
    }

    // SourceConfig CRUD
    if (req.method === 'GET' && path === '/api/sources/config') {
      if (!storage) { json(res, 200, { configs: [] }); return; }
      const userId = u.searchParams.get('user_id') || undefined;
      const platform = u.searchParams.get('platform') || undefined;
      json(res, 200, { configs: storage.listSourceConfigs(userId, platform) });
      return;
    }

    if (req.method === 'POST' && path === '/api/sources/config') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.platform || !body.source_type || !body.identifier) {
        jsonError(res, 400, 'MISSING_FIELDS', 'platform, source_type, and identifier are required');
        return;
      }
      const validSourceTypes = ['followed_creator', 'keyword_hot', 'keyword_latest', 'big_hot'];
      if (!validSourceTypes.includes(body.source_type as string)) {
        jsonError(res, 400, 'INVALID_SOURCE_TYPE', `source_type must be one of: ${validSourceTypes.join(', ')}`);
        return;
      }
      const config = storage.createSourceConfig(body as any);
      json(res, 201, { config });
      return;
    }

    if (req.method === 'PUT' && path.startsWith('/api/sources/config/')) {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const id = path.slice('/api/sources/config/'.length);
      if (!id) { jsonError(res, 400, 'ID_REQUIRED', 'Config ID is required'); return; }
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      const updated = storage.updateSourceConfig(id, body as any);
      if (!updated) { jsonError(res, 404, 'NOT_FOUND', `SourceConfig ${id} not found`); return; }
      json(res, 200, { config: updated });
      return;
    }

    if (req.method === 'DELETE' && path.startsWith('/api/sources/config/')) {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const id = path.slice('/api/sources/config/'.length);
      if (!id) { jsonError(res, 400, 'ID_REQUIRED', 'Config ID is required'); return; }
      const deleted = storage.deleteSourceConfig(id);
      json(res, deleted ? 200 : 404, { deleted });
      return;
    }

    // Feedback API
    if (req.method === 'POST' && path === '/api/feedback') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.item_id || !body.action) {
        jsonError(res, 400, 'MISSING_FIELDS', 'item_id and action are required');
        return;
      }
      const validActions = ['not_interested', 'archive', 'ingest'];
      if (!validActions.includes(body.action as string)) {
        jsonError(res, 400, 'INVALID_ACTION', `action must be one of: ${validActions.join(', ')}`);
        return;
      }
      const feedback = storage.createFeedback(body as any);
      if (body.action === 'not_interested' || body.action === 'archive') {
        storage.updateContentStatus(body.item_id as string, { digest_status: body.action as string });
      } else if (body.action === 'ingest') {
        storage.updateContentStatus(body.item_id as string, { digest_status: 'ingested' });
      }
      json(res, 201, { feedback });
      return;
    }

    if (req.method === 'GET' && path === '/api/feedback') {
      if (!storage) { json(res, 200, { feedbacks: [] }); return; }
      const userId = u.searchParams.get('user_id') || undefined;
      const itemId = u.searchParams.get('item_id') || undefined;
      const action = u.searchParams.get('action') || undefined;
      json(res, 200, { feedbacks: storage.listFeedbacks({ userId, itemId, action }) });
      return;
    }

    if (req.method === 'POST' && path === '/api/crawl/trigger') {
      if (!storage) {
        jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected');
        return;
      }
      let raw: string;
      try {
        raw = await readBody(req);
      } catch {
        jsonError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds size limit');
        return;
      }
      let body: { platform?: string; query?: string };
      try {
        body = raw.length ? JSON.parse(raw) as { platform?: string; query?: string } : {};
      } catch {
        jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
        return;
      }
      const platform = body.platform;
      if (!platform || !(crawlPlatforms as readonly string[]).includes(platform)) {
        jsonError(res, 400, 'INVALID_PLATFORM', `Invalid platform. Expected one of: ${[...crawlPlatforms].join(', ')}`);
        return;
      }
      const q = noQueryPlatforms.has(platform) ? (body.query ?? '') : body.query;
      if (!noQueryPlatforms.has(platform) && (q === undefined || q === null || q === '')) {
        jsonError(res, 400, 'QUERY_REQUIRED', `query is required for platform ${platform}`);
        return;
      }
      const queryStr = typeof q === 'string' ? q : String(q);
      const result = await crawl(platform as CrawlPlatform, queryStr, { maxItems: 20 });
      const normalized = normalizeBatch(result.items);
      const unique = deduplicateByUrl(normalized);
      const saved = storage.insertBatch(unique);
      json(res, 200, {
        scraped: result.items.length,
        normalized: normalized.length,
        inserted: saved.length,
        has_more: result.has_more,
        next_cursor: result.next_cursor,
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/recommend') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const { Recommender } = await import('../recommend/index.js');
      if (!cachedRecommender) {
        cachedRecommender = new Recommender(storage);
        setImmediate(() => {
          try { cachedRecommender.buildProfile(); } catch {}
          cachedRecommenderAt = Date.now();
        });
        json(res, 200, []);
        return;
      } else if (Date.now() - cachedRecommenderAt > 600_000) {
        setImmediate(() => {
          try { cachedRecommender.buildProfile(); } catch {}
          cachedRecommenderAt = Date.now();
        });
      }
      const parsedUrl = new URL(req.url!, `http://127.0.0.1:${PORT}`);
      const platform = parsedUrl.searchParams.get('platform') || undefined;
      const n = parseInt(parsedUrl.searchParams.get('n') || '20', 10);
      const topicsParam = parsedUrl.searchParams.get('topics');
      const customKeywords = topicsParam ? topicsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
      const weightsParam = parsedUrl.searchParams.get('weights');
      let weights: Record<string, number> | undefined;
      if (weightsParam) {
        try { weights = JSON.parse(weightsParam); } catch {}
      }
      const userId = parsedUrl.searchParams.get('user_id') || undefined;
      const recs = cachedRecommender.forYou({
        userId,
        maxItems: n,
        platforms: platform ? [platform] : undefined,
        customKeywords: customKeywords.length > 0 ? customKeywords : undefined,
        weights,
      });
      json(res, 200, recs.map((r: any) => ({
        title: r.item.title,
        platform: r.item.platform,
        url: r.item.source_url,
        score: r.score,
        signals: r.signals,
        reason: r.reason,
        timestamp: r.item.timestamp,
        author: r.item.author || '',
        content_type: r.contentType || 'text',
        source_type: r.sourceType || 'api_crawl',
        digest_status: r.digestStatus || 'collected',
        media_status: r.mediaStatus || null,
        temp_doc_id: r.tempDocId || null,
        local_play_url: r.localPlayUrl || null,
        watch_url: r.watchUrl || r.item.source_url || null,
      })));
      return;
    }

    if (req.method === 'GET' && path === '/api/interests') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const interests = storage.listInterests();
      json(res, 200, interests);
      return;
    }

    if (req.method === 'GET' && path === '/api/suggest-topics') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      const { Recommender } = await import('../recommend/index.js');
      const { KnowledgeGraph } = await import('../fusion/knowledge-graph.js');
      const graph = new KnowledgeGraph();
      const items = storage.listContent(undefined, 500);
      graph.addBatch(items);
      const hubs = graph.getHubs(15).filter(h => h.label && h.type === 'entity').map(h => ({
        label: h.label,
        weight: h.weight,
        type: h.type,
      }));
      const platforms = [...new Set(items.map(i => i.platform))];
      const platformCounts: Record<string, number> = {};
      for (const item of items) platformCounts[item.platform] = (platformCounts[item.platform] || 0) + 1;
      json(res, 200, { suggested_topics: hubs, platforms: platformCounts });
      return;
    }

    if (req.method === 'POST' && path === '/api/push-to-knowlever') {
      let raw: string;
      try { raw = await readBody(req); } catch { jsonError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds size limit'); return; }
      let body: { url: string; topic: string; user?: string };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.url || !body.topic) { jsonError(res, 400, 'MISSING_FIELDS', 'url and topic are required'); return; }

      const { digestVideo } = await import('../preprocess/video-digest.js');
      const { pushVideoToKnowLever } = await import('../knowlever-push.js');

      try {
        const result = await digestVideo(body.url);
        const pushResult = pushVideoToKnowLever(
          result.videoPath, result.summaryPath, result.transcriptPath,
          result.title, { topic: body.topic, user: body.user },
        );
        json(res, 200, { ...pushResult, title: result.title, method: result.method });
      } catch (err: any) {
        jsonError(res, 500, 'PUSH_FAILED', err.message?.slice(0, 500) || String(err));
        emitBug(err, { component: 'api', operation: 'push-to-knowlever', url: body.url }).catch(() => {});
      }
      return;
    }

    if (req.method === 'GET' && path === '/api/knowlever/topics') {
      const { getAvailableTopics } = await import('../knowlever-push.js');
      json(res, 200, { topics: getAvailableTopics() });
      return;
    }

    // Video digest: async background job — returns 202 immediately
    if (req.method === 'GET' && path === '/api/video/digest/status') {
      const url = u.searchParams.get('url')?.trim();
      if (!url) { jsonError(res, 400, 'URL_REQUIRED', 'url query param is required'); return; }
      const job = videoDigestJobs.get(videoDigestJobKey(url));
      if (!job) {
        json(res, 200, { status: 'unknown', url, poll_timeout_ms: pollTimeoutMs() });
        return;
      }
      const payload: Record<string, unknown> = {
        status: job.status,
        url: job.url,
        poll_timeout_ms: pollTimeoutMs(job.durationSeconds ?? job.result?.duration_seconds),
      };
      if (job.durationSeconds) payload.duration_seconds = job.durationSeconds;
      if (job.result) Object.assign(payload, job.result);
      if (job.error) payload.error = job.error;
      json(res, 200, payload);
      return;
    }

    if (req.method === 'POST' && path === '/api/video/digest') {
      let raw: string;
      try { raw = await readBody(req); } catch { jsonError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds size limit'); return; }
      let body: { url: string; topic?: string; push_knowlever?: boolean; force_asr?: boolean };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }
      if (!body.url) { jsonError(res, 400, 'URL_REQUIRED', 'url field is required'); return; }

      const jobKey = videoDigestJobKey(body.url);
      const existing = videoDigestJobs.get(jobKey);
      if (existing && (existing.status === 'pending' || existing.status === 'running')) {
        json(res, 202, {
          status: 'already_running',
          url: body.url,
          poll_timeout_ms: pollTimeoutMs(existing.durationSeconds),
        });
        return;
      }

      const itemId = storage?.findContentIdByUrl(body.url) ?? null;
      if (itemId) storage!.updateContentStatus(itemId, { digest_status: 'digesting' });

      videoDigestJobs.set(jobKey, {
        status: 'pending',
        url: body.url,
        startedAt: Date.now(),
      });

      json(res, 202, {
        status: 'started',
        url: body.url,
        poll_timeout_ms: pollTimeoutMs(),
      });

      void (async () => {
        const job = videoDigestJobs.get(jobKey)!;
        job.status = 'running';
        const { digestVideo } = await import('../preprocess/video-digest.js');
        try {
          const result = await digestVideo(body.url, { forceAsr: body.force_asr ?? false });
          job.durationSeconds = result.durationSeconds;
          const response: VideoDigestJob['result'] = {
            title: result.title,
            method: result.method,
            duration_seconds: result.durationSeconds,
            transcript_preview: result.transcript.slice(0, 500),
            summary_preview: result.summary.slice(0, 1000),
            has_transcript: result.transcript.length > 0,
            has_summary: result.summary.length > 0,
          };

          if (body.push_knowlever !== false) {
            const { pushVideoToKnowLever } = await import('../knowlever-push.js');
            const topic = body.topic || 'video-digests';
            const pushResult = pushVideoToKnowLever(
              result.videoPath, result.summaryPath, result.transcriptPath,
              result.title, { topic },
            );
            response.knowlever = { pushed: pushResult.pushed.length > 0, topic };
          }

          job.result = response;
          job.status = 'done';
          if (itemId) {
            storage?.updateContentStatus(itemId, {
              digest_status: 'digested_pending',
              media_status: result.mediaStatus,
            });
          }
        } catch (err: any) {
          job.status = 'failed';
          job.error = err.message?.slice(0, 500) || String(err);
          if (itemId) storage?.updateContentStatus(itemId, { digest_status: 'collected' });
          emitBug(err, { component: 'api', operation: 'video-digest', url: body.url }).catch(() => {});
        }
      })();
      return;
    }

    if (req.method === 'POST' && path === '/api/research/trigger') {
      const { KnowledgeGraph } = await import('../fusion/knowledge-graph.js');
      const { researchGaps } = await import('../research/deep-researcher.js');

      const graph = new KnowledgeGraph();
      if (storage) {
        const items = storage.listContent(undefined, 1000);
        graph.addBatch(items);
      }

      const gaps = graph.detectKnowledgeGaps(5);
      if (gaps.length === 0) {
        json(res, 200, { status: 'no_gaps', message: 'No knowledge gaps detected', gaps: [] });
        return;
      }

      json(res, 202, { status: 'started', gaps_count: gaps.length, gaps: gaps.map(g => ({ type: g.type, title: g.title })) });

      researchGaps(gaps).then(results => {
        if (storage && results.length > 0) {
          for (const r of results) {
            const { normalizeBatch: nb, deduplicateByUrl: dd } = require('../normalizer/index.js');
            const unique = dd(nb(r.findings));
            storage.insertBatch(unique);
          }
        }
        console.log(`[Research] Completed: ${results.length} gaps researched, ${results.reduce((s, r) => s + r.findings.length, 0)} findings`);
      }).catch(err => console.error('[Research] Background task failed:', err));
      return;
    }

    if (req.method === 'GET' && path === '/api/research/gaps') {
      const { KnowledgeGraph } = await import('../fusion/knowledge-graph.js');
      const graph = new KnowledgeGraph();
      if (storage) {
        const items = storage.listContent(undefined, 1000);
        graph.addBatch(items);
      }
      const gaps = graph.detectKnowledgeGaps(10);
      json(res, 200, { gaps });
      return;
    }

    if (req.method === 'POST' && path === '/api/download/bilibili') {
      let raw: string;
      try { raw = await readBody(req); } catch { jsonError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds size limit'); return; }
      let body: { url?: string; query?: string; maxItems?: number; quality?: string };
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }

      const { downloadBilibiliVideo, discoverAndDownload } = await import('../scrapers/bilibili-download.js');

      if (body.url) {
        const result = await downloadBilibiliVideo(body.url, { quality: (body.quality as any) || '720p' });
        json(res, 200, { downloaded: result ? [result.path] : [], errors: result ? 0 : 1 });
      } else if (body.query) {
        const result = await discoverAndDownload(body.query, { maxItems: body.maxItems || 5 });
        json(res, 200, result);
      } else {
        jsonError(res, 400, 'MISSING_FIELDS', 'url or query is required');
      }
      return;
    }

    // ── WeRSS Webhook receiver (微信公众号文章推送) ──

    if (req.method === 'POST' && path === '/api/webhook/wechat') {
      if (!storage) { jsonError(res, 503, 'DATABASE_UNAVAILABLE', 'Storage is not connected'); return; }
      let raw: string;
      try { raw = await readBody(req); } catch { jsonError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds size limit'); return; }
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON'); return; }

      const title = String(body.title ?? body.Title ?? '');
      const content = String(body.content ?? body.Content ?? body.description ?? '');
      const author = String(body.author ?? body.Author ?? body.mp_name ?? '');
      const link = String(body.link ?? body.Link ?? body.url ?? '');
      const pubDate = String(body.pub_date ?? body.pubDate ?? body.publish_time ?? '');

      if (!title) { jsonError(res, 400, 'MISSING_TITLE', 'title is required'); return; }

      const item: import('../types/index.js').ContentItem = {
        id: '',
        title,
        body_markdown: content || `## ${title}`,
        author,
        timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source_url: link,
        platform: 'wechat',
        tags: ['wechat', 'webhook', author].filter(Boolean),
        raw_metadata: {
          source_type: 'webhook',
          content_type: 'article',
          channel: author,
          raw_payload_keys: Object.keys(body),
        },
        scraped_at: new Date().toISOString(),
      };

      const normalized = normalizeBatch([item]);
      const deduped = deduplicateByUrl(normalized);
      let saved = 0;
      for (const d of deduped) {
        try {
          const result = storage.insertContent(d);
          if (result) saved++;
        } catch { /* dup */ }
      }
      console.error(`[Webhook:wechat] Received: "${title}" by ${author} → saved ${saved}/${deduped.length}`);
      json(res, 200, { ok: true, saved, total: deduped.length });
      return;
    }

    // ── PolarClaw Lobster Adapter endpoints ──

    const lobsterStatusDeps = (): StatusDeps => ({
      dbConnected: dbMeta.status === 'connected',
      itemCount: storage?.contentCount?.() ?? 0,
      apiPort: PORT,
      activeJobs: storage?.listJobs?.()?.filter((j: any) => j.enabled)?.length ?? 0,
    });

    if (req.method === 'GET' && path === '/api/lobster/status') {
      json(res, 200, getStatus(lobsterStatusDeps()));
      return;
    }

    if (req.method === 'GET' && path === '/api/lobster/health') {
      const result = await runHealthCheck(lobsterStatusDeps());
      json(res, result.healthy ? 200 : 503, result);
      return;
    }

    if (req.method === 'POST' && path === '/api/lobster/test') {
      const result = await runTargetTest(lobsterStatusDeps());
      json(res, result.passed ? 200 : 500, result);
      return;
    }

    jsonStdError(res, 404, 'NOT_FOUND', `Endpoint ${path} not found`);
  } catch (err) {
    jsonStdError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    emitBug(err, { component: 'api', operation: 'unhandled', path }).catch(() => {});
  }
});

const _requireCjs = createRequire(import.meta.url);
try {
  const sdkPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'PolarPort', 'src', 'sdk', 'index.cjs');
  const { claimPort, registerCapabilities } = _requireCjs(sdkPath);
  PORT = await claimPort({ service: 'digist-api', project: 'digist', preferred: PREFERRED_PORT });

  const capPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'digist', 'capabilities.json');
  registerCapabilities(capPath).catch((e: unknown) => console.warn('[digist] capability registration failed (non-fatal):', e));
} catch (e) {
  console.error('[digist] port-sdk claimPort failed — aborting:', e);
  process.exit(1);
}

import { SmartScheduler } from '../scheduler/smart-scheduler.js';
import net from 'node:net';

async function isPortFree(port: number): Promise<boolean> {
  const hosts = ['127.0.0.1', '::'];
  for (const host of hosts) {
    const busy = await new Promise<boolean>((res) => {
      const tester = net.createServer();
      tester.once('error', () => res(true));
      tester.listen(port, host, () => { tester.close(() => res(false)); });
    });
    if (busy) return false;
  }
  return true;
}

async function killPortOccupant(port: number, maxRetries = 3): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await isPortFree(port)) return true;

    console.warn(`[digist-api] Port ${port} occupied (attempt ${i + 1}/${maxRetries}), killing occupant...`);
    try {
      const { stdout } = await execAsync('lsof', ['-ti', `:${port}`]);
      const pids = stdout.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        if (pid === String(process.pid)) continue;
        try { process.kill(Number(pid), 'SIGTERM'); } catch {}
      }
      await new Promise((r) => setTimeout(r, 2000));
    } catch {}
  }
  return await isPortFree(port);
}

const portReady = await killPortOccupant(PORT);
if (!portReady) {
  console.error(`[digist-api] FATAL: port ${PORT} still occupied after retries — aborting`);
  process.exit(1);
}

let smartScheduler: SmartScheduler | null = null;

if (storage && process.env.DIGIST_SMART_SCHEDULER !== '0') {
  const store = storage;
  smartScheduler = new SmartScheduler(store);
  smartScheduler.onNewItems = () => {
    backgroundRefresh(store, new Date().toISOString().slice(0, 10));
  };
  smartScheduler.start();
  console.log('[digist-api] SmartScheduler enabled — platforms auto-schedule based on per-platform intervals');
}

if (storage) {
  startDailyReportCron(storage);
}

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[digist-api] EADDRINUSE on port ${PORT} — another instance may be running. Exiting.`);
    process.exit(1);
  }
  console.error('[digist-api] Server error:', err);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`digist-api listening on http://127.0.0.1:${PORT}`);
});

function shutdown(signal: string) {
  console.log(`[digist-api] ${signal} received, shutting down...`);
  if (smartScheduler) smartScheduler.stop();
  server.close(() => {
    if (storage) storage.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
