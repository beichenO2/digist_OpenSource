import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import type { AntiScrapingConfig, RateLimiterConfig } from '../types/index.js';

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
];

class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.maxRequests;
    this.tokens = config.maxRequests;
    this.refillRate = config.maxRequests / config.windowMs;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitMs = (1 - this.tokens) / this.refillRate;
      await sleep(Math.ceil(waitMs));
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomizeHeaders(): Record<string, string> {
  const languages = ['en-US,en;q=0.9', 'en-GB,en;q=0.9', 'zh-CN,zh;q=0.9,en;q=0.8'];
  const platforms = ['"macOS"', '"Windows"', '"Linux"'];
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': pickRandom(languages),
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua-Platform': pickRandom(platforms),
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'no-cache',
  };
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        const jitter = Math.random() * 0.5 + 0.75; // 0.75-1.25x
        const delay = baseDelayMs * Math.pow(2, attempt) * jitter;
        await sleep(Math.ceil(delay));
      }
    }
  }
  throw lastError;
}

const DEFAULT_CONFIG: AntiScrapingConfig = {
  rateLimiter: { maxRequests: 10, windowMs: 60_000 },
  userAgents: DEFAULT_USER_AGENTS,
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  proxies: [],
};

export function createSafeAxios(config: Partial<AntiScrapingConfig> = {}): {
  client: AxiosInstance;
  limiter: TokenBucketLimiter;
} {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const limiter = new TokenBucketLimiter(cfg.rateLimiter);
  let proxyIndex = 0;

  const client = axios.create({ timeout: 30_000 });

  client.interceptors.request.use(async (reqConfig) => {
    await limiter.acquire();

    reqConfig.headers['User-Agent'] = pickRandom(cfg.userAgents);
    Object.assign(reqConfig.headers, randomizeHeaders());

    if (cfg.proxies.length > 0) {
      const proxy = cfg.proxies[proxyIndex % cfg.proxies.length]!;
      proxyIndex++;
      const url = new URL(proxy);
      reqConfig.proxy = {
        host: url.hostname,
        port: parseInt(url.port),
        protocol: url.protocol.replace(':', ''),
        ...(url.username ? { auth: { username: url.username, password: url.password } } : {}),
      };
    }

    return reqConfig;
  });

  return { client, limiter };
}

export async function safeRequest<T>(
  client: AxiosInstance,
  config: AxiosRequestConfig,
  maxRetries = 3,
): Promise<T> {
  return retryWithBackoff(
    async () => {
      const resp = await client.request<T>(config);
      return resp.data;
    },
    maxRetries,
    1000,
  );
}
