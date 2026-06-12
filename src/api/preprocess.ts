/**
 * Stable entry for dependents (`digest.preprocess` capability).
 * Re-exports normalization pipeline used after crawl.
 */
export {
  normalize,
  normalizeBatch,
  deduplicateByUrl,
  calculateInfoDensity,
} from '../normalizer/index.js';
