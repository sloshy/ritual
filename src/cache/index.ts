export {
  getCacheDir,
  getImageCacheDir,
  getCacheFile,
  type CacheSection,
  type DataType,
  streamFromBatchResults,
  FileCacheManager,
} from './file-cache'

export { HttpCacheManager } from './http-cache'
export { RuntimeCacheManager } from './runtime-cache'

import { getCacheFile } from './file-cache'
import { RuntimeCacheManager } from './runtime-cache'

// Instances — use lazy path getters so --base-dir is respected at call time
export const defaultCache = new RuntimeCacheManager(getCacheFile, 'prices')

// 0 means no expiration (infinite)
export const cardCache = new RuntimeCacheManager(getCacheFile, 'cards', 0)
