/**
 * L3 platform configs + seed selectors.
 *
 * These platforms are JS-heavy / redesign-prone; L3 opens them in the isolated
 * anti-detect browser and, when the seed selectors below stop matching, the
 * LLM heals fresh ones (persisted to data/selector-config/). Seeds mirror the
 * DOM shapes the old Safari jsTemplate targeted, so a healthy page needs no LLM.
 */
import type { L3Config, SelectorSet } from './types.js';

export interface L3Registration {
  config: L3Config;
  seed?: SelectorSet;
}

export const L3_REGISTRATIONS: Record<string, L3Registration> = {
  bloomberg: {
    config: {
      platform: 'bloomberg',
      buildUrl: () => 'https://www.bloomberg.com/technology',
      itemDescription: 'Bloomberg 科技新闻的文章标题条目（每条含标题和链接）',
    },
    seed: { item: 'article, [data-component=headline]', title: 'h3, h2, .headline', link: 'a', source: 'manual' },
  },
  zhihu: {
    config: {
      platform: 'zhihu',
      buildUrl: (q: string) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}`,
      waitFor: '.List-item',
      itemDescription: '知乎搜索结果的内容条目（每条含问题/文章标题、可选作者、链接）',
    },
    seed: { item: '.List-item', title: 'h2 span, h2 a, h2', link: 'h2 a', source: 'manual' },
  },
};
