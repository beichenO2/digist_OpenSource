/**
 * PolarClaw Lobster event types — aligned with SOTAgent lobster-events schema.
 *
 * Schema: {ts, type, source_project, target_project?, severity, payload, dedup_key}
 * Type enum follows SOTAgent_LobsterEvents.md canonical set.
 */

export const LOBSTER_EVENT_TYPES = [
  'bug',
  'digist_report',
  'contract_red',
  'git_push_main',
  'scheduled_health_scan',
] as const;

export type LobsterEventType = (typeof LOBSTER_EVENT_TYPES)[number];

export type EventSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface LobsterEvent {
  ts: string;
  type: LobsterEventType;
  source_project: string;
  target_project?: string;
  severity: EventSeverity;
  payload: Record<string, unknown>;
  dedup_key: string;
}

export interface EmitResult {
  ok: boolean;
  method: 'sotagent_api' | 'local_fallback';
  error?: string;
}

export interface ProjectStatus {
  project: string;
  status: 'healthy' | 'degraded' | 'down';
  db: { connected: boolean; item_count: number };
  api: { listening: boolean; port: number | null };
  scheduler: { active_jobs: number };
  last_event_ts: string | null;
}

export interface HealthCheckResult {
  healthy: boolean;
  checks: {
    name: string;
    passed: boolean;
    detail?: string;
  }[];
  ts: string;
}

export interface TargetTestResult {
  passed: boolean;
  tests: {
    name: string;
    passed: boolean;
    error?: string;
  }[];
  ts: string;
}
