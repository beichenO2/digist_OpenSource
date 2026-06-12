import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface EvolutionEntry {
  id: number;
  timestamp: string;
  type: 'strategy_change' | 'source_discovery' | 'pipeline_tuning' | 'quality_shift' | 'milestone';
  description: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  impact_measured: number | null;
  rollback_possible: boolean;
}

export class EvolutionLog {
  private logDir: string;
  private logFile: string;
  private entries: EvolutionEntry[] = [];
  private nextId = 1;

  constructor(logDir: string = './data/evolution') {
    this.logDir = logDir;
    this.logFile = join(logDir, 'evolution.jsonl');
    mkdirSync(logDir, { recursive: true });
    this.loadExisting();
  }

  record(entry: Omit<EvolutionEntry, 'id' | 'timestamp'>): EvolutionEntry {
    const full: EvolutionEntry = {
      ...entry,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(full);
    appendFileSync(this.logFile, JSON.stringify(full) + '\n');

    return full;
  }

  recordStrategyChange(
    jobId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    reason: string,
  ): EvolutionEntry {
    return this.record({
      type: 'strategy_change',
      description: `Job ${jobId}: ${reason}`,
      before,
      after,
      impact_measured: null,
      rollback_possible: true,
    });
  }

  recordSourceDiscovery(
    platform: string,
    query: string,
    reason: string,
  ): EvolutionEntry {
    return this.record({
      type: 'source_discovery',
      description: `New source: ${platform} — "${query}". ${reason}`,
      before: {},
      after: { platform, query },
      impact_measured: null,
      rollback_possible: true,
    });
  }

  recordPipelineTuning(
    parameter: string,
    before: number,
    after: number,
    reason: string,
  ): EvolutionEntry {
    return this.record({
      type: 'pipeline_tuning',
      description: `Pipeline: ${parameter} ${before} → ${after}. ${reason}`,
      before: { [parameter]: before },
      after: { [parameter]: after },
      impact_measured: null,
      rollback_possible: true,
    });
  }

  recordMilestone(description: string, metrics: Record<string, unknown>): EvolutionEntry {
    return this.record({
      type: 'milestone',
      description,
      before: {},
      after: metrics,
      impact_measured: null,
      rollback_possible: false,
    });
  }

  measureImpact(entryId: number, impact: number): void {
    const entry = this.entries.find(e => e.id === entryId);
    if (entry) {
      entry.impact_measured = impact;
    }
  }

  getHistory(limit = 50): EvolutionEntry[] {
    return this.entries.slice(-limit);
  }

  getByType(type: EvolutionEntry['type']): EvolutionEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  getRollbackCandidates(): EvolutionEntry[] {
    return this.entries
      .filter(e => e.rollback_possible && e.impact_measured !== null && e.impact_measured < 0)
      .sort((a, b) => (a.impact_measured || 0) - (b.impact_measured || 0));
  }

  generateReport(): string {
    const lines: string[] = [];
    lines.push('# Evolution Log Report\n');
    lines.push(`Total entries: ${this.entries.length}\n`);

    const byType: Record<string, number> = {};
    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    lines.push('## By Type\n');
    for (const [type, count] of Object.entries(byType)) {
      lines.push(`- ${type}: ${count}`);
    }
    lines.push('');

    const measured = this.entries.filter(e => e.impact_measured !== null);
    if (measured.length > 0) {
      const avgImpact = measured.reduce((sum, e) => sum + (e.impact_measured || 0), 0) / measured.length;
      lines.push(`## Impact Summary\n`);
      lines.push(`- Measured changes: ${measured.length}`);
      lines.push(`- Average impact: ${avgImpact.toFixed(3)}`);
      lines.push(`- Positive changes: ${measured.filter(e => (e.impact_measured || 0) > 0).length}`);
      lines.push(`- Negative changes: ${measured.filter(e => (e.impact_measured || 0) < 0).length}`);
      lines.push('');
    }

    lines.push('## Recent Entries\n');
    for (const entry of this.entries.slice(-10)) {
      const impact = entry.impact_measured !== null ? ` (impact: ${entry.impact_measured.toFixed(3)})` : '';
      lines.push(`- [${entry.timestamp.slice(0, 19)}] [${entry.type}] ${entry.description}${impact}`);
    }

    return lines.join('\n');
  }

  private loadExisting(): void {
    if (!existsSync(this.logFile)) return;

    try {
      const content = readFileSync(this.logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as EvolutionEntry;
          this.entries.push(entry);
          this.nextId = Math.max(this.nextId, entry.id + 1);
        } catch { /* skip malformed */ }
      }
    } catch { /* file doesn't exist or unreadable */ }
  }
}
