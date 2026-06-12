/**
 * PolarClaw Project SDK Adapter for digist.
 *
 * Uses port-sdk call() for event emission (primary), falls back to direct
 * file append when SOTAgent is unreachable.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const _req = createRequire(import.meta.url);
const _sdkPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', 'PolarPort', 'src', 'sdk', 'index.cjs');
let _call: ((capId: string, input: any, opts?: any) => Promise<any>) | null = null;
try {
  const sdk = _req(_sdkPath);
  _call = sdk.call;
} catch { /* port-sdk not available, will use file fallback */ }

const EVENTS_PATH = resolve(
  process.env.LOBSTER_EVENTS_PATH ||
  resolve(process.cwd(), '..', 'SOTAgent', 'data', 'lobster-events.jsonl'),
);

const SOURCE_PROJECT = 'digist';

export interface LobsterEvent {
  ts: string;
  type: 'bug' | 'digist_report' | 'contract_red' | 'git_push_main' | 'scheduled_health_scan';
  source_project: 'digist';
  target_project?: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  payload: Record<string, unknown>;
  dedup_key: string;
}

export interface StatusDeps {
  dbConnected: boolean;
  itemCount: number;
  apiPort: number;
  activeJobs: number;
}

function ensureEventsDir(): void {
  const dir = dirname(EVENTS_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function emitEvent(event: Omit<LobsterEvent, 'ts' | 'source_project'>): LobsterEvent {
  const full: LobsterEvent = {
    ts: new Date().toISOString(),
    source_project: SOURCE_PROJECT,
    ...event,
  };

  if (_call) {
    _call('sotagent.lobster.emit', full, { validateInput: false, validateOutput: false })
      .catch(() => {
        ensureEventsDir();
        appendFileSync(EVENTS_PATH, JSON.stringify(full) + '\n', 'utf-8');
      });
  } else {
    ensureEventsDir();
    appendFileSync(EVENTS_PATH, JSON.stringify(full) + '\n', 'utf-8');
  }

  console.log(`[digist-sdk] Event emitted: type=${full.type} dedup=${full.dedup_key}`);
  return full;
}

export async function emitBug(
  errOrOpts: unknown,
  extra?: { component?: string; operation?: string; [k: string]: unknown },
): Promise<LobsterEvent> {
  const message = errOrOpts instanceof Error
    ? errOrOpts.message
    : typeof errOrOpts === 'string'
      ? errOrOpts
      : typeof (errOrOpts as any)?.message === 'string'
        ? (errOrOpts as any).message
        : String(errOrOpts);

  const component = extra?.component || 'unknown';
  const operation = extra?.operation || 'unknown';

  return emitEvent({
    type: 'bug',
    severity: 'error',
    payload: {
      message: message.slice(0, 500),
      component,
      operation,
      ...(errOrOpts instanceof Error ? { stack: errOrOpts.stack?.slice(0, 300) } : {}),
    },
    dedup_key: `digist:bug:${component}:${operation}`,
  });
}

export async function emitReport(opts: {
  title: string;
  targetProject?: string;
  sourcesCount?: number;
  sources_count?: number;
  insightsCount?: number;
  insights_count?: number;
  topics?: string[];
  [k: string]: unknown;
}, targetProject?: string): Promise<LobsterEvent> {
  const target = targetProject || opts.targetProject;
  const srcCount = opts.sourcesCount ?? opts.sources_count ?? 0;
  const insCount = opts.insightsCount ?? opts.insights_count ?? 0;

  return emitEvent({
    type: 'digist_report',
    severity: 'info',
    ...(target ? { target_project: target } : {}),
    payload: {
      title: opts.title,
      sources_count: srcCount,
      insights_count: insCount,
      topics: opts.topics || [],
    },
    dedup_key: `digist:digist_report:report:${opts.title.slice(0, 40)}`,
  });
}

export const emitDigistReport = emitReport;

export function getStatus(deps?: StatusDeps): {
  project: string;
  status: string;
  health: Record<string, unknown>;
} {
  let polarisInfo: Record<string, unknown> = {};
  try {
    const polarisPath = resolve(process.cwd(), 'polaris.json');
    if (existsSync(polarisPath)) {
      const raw = JSON.parse(readFileSync(polarisPath, 'utf-8'));
      polarisInfo = {
        name: raw.name,
        status: raw.status,
        version: raw.version,
        requirementsCount: raw.requirements?.length || 0,
      };
    }
  } catch { /* non-critical */ }

  return {
    project: SOURCE_PROJECT,
    status: 'active',
    health: {
      polaris: polarisInfo,
      eventsPath: EVENTS_PATH,
      eventsFileExists: existsSync(EVENTS_PATH),
      ...(deps ? {
        dbConnected: deps.dbConnected,
        itemCount: deps.itemCount,
        apiPort: deps.apiPort,
        activeJobs: deps.activeJobs,
      } : {}),
    },
  };
}

export async function runHealthCheck(deps?: StatusDeps): Promise<{
  healthy: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  checks.push({
    name: 'polaris.json',
    ok: existsSync(resolve(process.cwd(), 'polaris.json')),
  });

  checks.push({
    name: 'contracts_dir',
    ok: existsSync(resolve(process.cwd(), 'contracts')),
  });

  checks.push({
    name: 'lobster_targets',
    ok: existsSync(resolve(process.cwd(), 'lobster', 'targets')),
  });

  if (deps) {
    checks.push({ name: 'database', ok: deps.dbConnected });
  }

  let apiOk = false;
  const port = deps?.apiPort || 3800;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health?fast=1`, { signal: AbortSignal.timeout(3000) });
    apiOk = resp.ok;
  } catch { /* API not running is acceptable during startup */ }
  checks.push({ name: 'digist_api', ok: apiOk, detail: apiOk ? undefined : 'API not reachable' });

  return {
    healthy: checks.filter(c => c.name !== 'digist_api').every(c => c.ok),
    checks,
  };
}

export async function runTargetTest(deps?: StatusDeps): Promise<{
  passed: boolean;
  tests: Array<{ name: string; ok: boolean; detail?: string }>;
}> {
  const tests: Array<{ name: string; ok: boolean; detail?: string }> = [];

  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(execFile);

    const { stdout } = await execAsync('npx', ['tsx', 'tests/contracts/contract.test.ts'], {
      cwd: process.cwd(),
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const passMatch = stdout.match(/(\d+) passed/);
    const failMatch = stdout.match(/(\d+) failed/);
    const passed = parseInt(passMatch?.[1] || '0', 10);
    const failed = parseInt(failMatch?.[1] || '0', 10);

    tests.push({
      name: 'contract_tests',
      ok: failed === 0,
      detail: `${passed} passed, ${failed} failed`,
    });
  } catch (err: any) {
    tests.push({
      name: 'contract_tests',
      ok: false,
      detail: err.message?.slice(0, 200),
    });
  }

  return {
    passed: tests.every(t => t.ok),
    tests,
  };
}
