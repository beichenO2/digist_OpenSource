/**
 * L3 Agentic fallback handler factory.
 *
 * Flow when invoked (only after L1 returns empty / throws):
 *   1. open URL in isolated anti-detect browser → HTML
 *   2. try cached/seeded selectors → cheerio extract
 *   3. if they no longer match → LLM heals a new SelectorSet, validate, persist
 *   4. extract → ContentItem[]
 *
 * Degrades safely: if patchright or the LLM is unavailable, returns empty items
 * (never throws), so a failing L3 never aborts a crawl.
 */
import * as cheerio from 'cheerio';
import { nanoid } from 'nanoid';
import type { ContentItem, ScraperOptions } from '../../types/index.js';
import type { LayerHandler } from '../types.js';
import type { L3Config, SelectorSet } from './types.js';
import { capturePage } from './browser.js';
import { loadSelectors, saveSelectors } from './selector-store.js';
import { healSelectors, validateSelectors } from './healer.js';

function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function extract(
  html: string,
  sel: SelectorSet,
  platform: string,
  pageUrl: string,
  maxItems: number,
): ContentItem[] {
  const $ = cheerio.load(html);
  const items: ContentItem[] = [];
  $(sel.item).each((_, el) => {
    if (items.length >= maxItems) return;
    const $el = $(el);
    const title = $el.find(sel.title).first().text().trim();
    if (!title) return;
    const href = sel.link ? ($el.find(sel.link).first().attr('href') || '') : ($el.find('a').first().attr('href') || '');
    const author = sel.author ? $el.find(sel.author).first().text().trim() : '';
    items.push({
      id: '',
      title: title.slice(0, 300),
      body_markdown: title,
      author,
      timestamp: new Date().toISOString(),
      source_url: href ? absoluteUrl(href, pageUrl) : pageUrl,
      platform: platform as ContentItem['platform'],
      tags: [platform, 'l3'],
      raw_metadata: { layer: 'L3', healed: sel.source === 'llm-healed', selector_learned_at: sel.learnedAt },
      scraped_at: new Date().toISOString(),
    });
  });
  return items;
}

/**
 * Build an L3 LayerHandler for a platform. `seed` is an optional starting
 * selector set (used before any heal has happened).
 */
export function createL3Handler(config: L3Config, seed?: SelectorSet): LayerHandler {
  return {
    layer: 'L3',
    platform: config.platform,
    async handle(query: string, options?: ScraperOptions) {
      const empty = { items: [] as ContentItem[], next_cursor: null, has_more: false };
      const maxItems = options?.maxItems ?? 15;
      const url = config.buildUrl(query);

      let capture;
      try {
        capture = await capturePage(url, { waitFor: config.waitFor });
      } catch (err) {
        console.error(`[L3:${config.platform}] browser capture failed:`, err instanceof Error ? err.message : err);
        return empty;
      }

      const html = capture.html;

      // 1. Try persisted selectors, then the seed.
      const candidates: SelectorSet[] = [];
      const persisted = loadSelectors(config.platform);
      if (persisted) candidates.push(persisted);
      if (seed) candidates.push(seed);

      for (const sel of candidates) {
        if (validateSelectors(html, sel).ok) {
          return { items: extract(html, sel, config.platform, url, maxItems), next_cursor: null, has_more: false };
        }
      }

      // 2. Self-heal via LLM, validate, persist, extract.
      const healed = await healSelectors(html, config.itemDescription);
      if (healed) {
        saveSelectors(config.platform, healed.set);
        console.log(`[L3:${config.platform}] selectors healed (matched ${healed.matched} items) → persisted`);
        return { items: extract(html, healed.set, config.platform, url, maxItems), next_cursor: null, has_more: false };
      }

      console.warn(`[L3:${config.platform}] no working selectors and heal failed — returning empty`);
      return empty;
    },
  };
}

export type { L3Config, SelectorSet } from './types.js';
