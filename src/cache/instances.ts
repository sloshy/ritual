import { getCacheFile } from './file-cache'
import { RuntimeCacheManager } from './runtime-cache'

// The shared cache instances live in this leaf module (rather than index.ts)
// so consumers that need them at module scope — e.g. src/scryfall/index.ts —
// don't ride the index.ts → ensure-cards → scryfall import cycle, where the
// bindings would still be in their temporal dead zone.

// Instances — use lazy path getters so --base-dir is respected at call time
export const defaultCache = new RuntimeCacheManager(getCacheFile, 'prices')

// 0 means no expiration (infinite)
export const cardCache = new RuntimeCacheManager(getCacheFile, 'cards', 0)
