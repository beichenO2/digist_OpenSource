import type { ScraperOptions } from '../types/index.js';
import { getStrategy, l1Strategies } from './registry.js';
import type { CollectResult } from './types.js';

export async function collect(
  platform: string,
  query: string,
  options?: ScraperOptions,
): Promise<CollectResult> {
  const strategy = getStrategy(platform);
  if (!strategy) {
    throw new Error(
      `Unknown platform: ${platform}. Expected one of: ${Object.keys(l1Strategies).join(', ')}`,
    );
  }

  try {
    const result = await strategy.primary.handle(query, options);

    if (result.items.length === 0 && strategy.fallback) {
      const fallbackResult = await strategy.fallback.handle(query, options);
      return {
        items: fallbackResult.items,
        layer: strategy.fallback.layer,
        degraded: true,
        next_cursor: fallbackResult.next_cursor,
        has_more: fallbackResult.has_more,
      };
    }

    return {
      items: result.items,
      layer: strategy.primary.layer,
      degraded: false,
      next_cursor: result.next_cursor,
      has_more: result.has_more,
    };
  } catch (err) {
    if (strategy.fallback) {
      const fallbackResult = await strategy.fallback.handle(query, options);
      return {
        items: fallbackResult.items,
        layer: strategy.fallback.layer,
        degraded: true,
        next_cursor: fallbackResult.next_cursor,
        has_more: fallbackResult.has_more,
      };
    }
    throw err;
  }
}
