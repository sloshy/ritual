export {
  CACHE_DIR,
  IMAGE_CACHE_DIR,
  CACHE_FILE,
  type CacheSection,
  type DataType,
  streamFromBatchResults,
  FileCacheManager,
} from './file-cache'

export { HttpCacheManager } from './http-cache'
export { RuntimeCacheManager } from './runtime-cache'

import { CACHE_FILE } from './file-cache'
import { RuntimeCacheManager } from './runtime-cache'

// Instances
export const defaultCache = new RuntimeCacheManager(CACHE_FILE, 'prices')

// 0 means no expiration (infinite)
export const cardCache = new RuntimeCacheManager(CACHE_FILE, 'cards', 0)
