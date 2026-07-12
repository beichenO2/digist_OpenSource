export type {
  CollectLayer,
  CollectResult,
  LayerHandler,
  PlatformStrategy,
} from './types.js';
export { collect } from './layered-collector.js';
export { getStrategy, l1Strategies } from './registry.js';
