/**
 * L3 Agentic fallback layer types.
 *
 * L3 只服务「免登但 JS 重 / 结构复杂 / selector 易碎」的站点。它跑在与日常
 * 浏览器完全隔离的反检测 Chromium（patchright）里，selector 失效时用 LLM
 * 重新定位元素并回写到 data/selector-config/{platform}.json，实现自愈。
 */

/** A CSS selector set for list-style extraction. Relative selectors resolve within `item`. */
export interface SelectorSet {
  /** Container selector — one match per result item. */
  item: string;
  /** Title text selector, relative to an item element. */
  title: string;
  /** Anchor selector whose href is the source URL, relative to an item. */
  link?: string;
  /** Author/byline selector, relative to an item. */
  author?: string;
  /** ISO timestamp of when this set was learned. */
  learnedAt?: string;
  /** Provenance: seeded manually or healed by the LLM. */
  source?: 'manual' | 'llm-healed';
}

/** Per-platform L3 navigation config. */
export interface L3Config {
  platform: string;
  /** Build the page URL to open for a given query. */
  buildUrl: (query: string) => string;
  /** Optional selector to wait for before extracting (page readiness). */
  waitFor?: string;
  /** Human description of what a result item looks like — fed to the healer. */
  itemDescription: string;
}
