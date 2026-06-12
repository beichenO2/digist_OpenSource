export type TriggerSource = 'lobster' | 'scheduled' | 'event' | 'manual';

export interface TriggerEvent {
  source: TriggerSource;
  query: string;
  platforms?: string[];
  priority: 'high' | 'normal' | 'low';
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface TriggerPolicy {
  name: string;
  enabled: boolean;
  source: TriggerSource;
  cronExpression?: string;
  eventPattern?: string;
  defaultPlatforms: string[];
  defaultPriority: 'high' | 'normal' | 'low';
}

const DEFAULT_POLICIES: TriggerPolicy[] = [
  {
    name: 'scheduled-trending',
    enabled: true,
    source: 'scheduled',
    cronExpression: '0 */4 * * *',
    defaultPlatforms: ['twitter', 'reddit', 'hackernews'],
    defaultPriority: 'normal',
  },
  {
    name: 'scheduled-academic',
    enabled: true,
    source: 'scheduled',
    cronExpression: '0 8 * * *',
    defaultPlatforms: ['arxiv', 'github'],
    defaultPriority: 'low',
  },
  {
    name: 'lobster-request',
    enabled: true,
    source: 'lobster',
    defaultPlatforms: ['twitter', 'reddit', 'wechat', 'github'],
    defaultPriority: 'high',
  },
  {
    name: 'event-glass-activity',
    enabled: true,
    source: 'event',
    eventPattern: 'glass:new_activity',
    defaultPlatforms: ['glass'],
    defaultPriority: 'normal',
  },
];

export class TriggerManager {
  private policies: TriggerPolicy[];
  private queue: TriggerEvent[] = [];

  constructor(policies?: TriggerPolicy[]) {
    this.policies = policies ?? DEFAULT_POLICIES;
  }

  enqueue(event: TriggerEvent): void {
    this.queue.push(event);
    this.queue.sort((a, b) => {
      const p = { high: 0, normal: 1, low: 2 };
      return p[a.priority] - p[b.priority];
    });
  }

  dequeue(): TriggerEvent | undefined {
    return this.queue.shift();
  }

  queueSize(): number {
    return this.queue.length;
  }

  getPolicies(): TriggerPolicy[] {
    return [...this.policies];
  }

  enablePolicy(name: string): void {
    const p = this.policies.find((p) => p.name === name);
    if (p) p.enabled = true;
  }

  disablePolicy(name: string): void {
    const p = this.policies.find((p) => p.name === name);
    if (p) p.enabled = false;
  }

  createEventFromLobster(query: string, platforms?: string[]): TriggerEvent {
    const policy = this.policies.find((p) => p.source === 'lobster' && p.enabled);
    return {
      source: 'lobster',
      query,
      platforms: platforms ?? policy?.defaultPlatforms ?? ['twitter', 'reddit'],
      priority: policy?.defaultPriority ?? 'high',
      timestamp: new Date().toISOString(),
    };
  }

  createScheduledEvent(query: string, policyName: string): TriggerEvent | null {
    const policy = this.policies.find((p) => p.name === policyName && p.enabled);
    if (!policy) return null;
    return {
      source: 'scheduled',
      query,
      platforms: policy.defaultPlatforms,
      priority: policy.defaultPriority,
      timestamp: new Date().toISOString(),
    };
  }
}
