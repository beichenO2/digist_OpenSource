import type { ContentItem, ScraperOptions } from '../types/index.js';

export type CollectLayer = 'L1' | 'L3';

export interface CollectResult {
  items: ContentItem[];
  layer: CollectLayer;
  degraded: boolean;
  next_cursor: string | null;
  has_more: boolean;
}

export interface LayerHandler {
  layer: CollectLayer;
  platform: string;
  handle(query: string, options?: ScraperOptions): Promise<{
    items: ContentItem[];
    next_cursor: string | null;
    has_more: boolean;
  }>;
}

export interface PlatformStrategy {
  platform: string;
  primary: LayerHandler;
  fallback?: LayerHandler;
}
