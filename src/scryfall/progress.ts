/**
 * The bulk card-cache refresh's progress vocabulary.
 *
 * This replaces the old process-global-logger swap, where the admin stream
 * scraped human log lines for `"Saving to cache"` / `"Done!"` / a percentage
 * regex that had silently stopped matching. The engine now says what it is doing
 * directly, and every consumer (the admin SSE route, the MCP progress sink) maps
 * from these events rather than from prose.
 */

/** One step of a bulk card-cache refresh, as the engine reports it. */
export interface CacheRefreshEvent {
  /**
   * Which phase of the refresh this is. `info` is the catch-all for steps no
   * client renders as its own stage.
   */
  stage: 'metadata' | 'tags' | 'download' | 'save' | 'done' | 'info'
  /** 0–100, present on `download` only when the compressed size is known. */
  percentage?: number
  message: string
}

/** Where {@link PreloadCacheOptions.onProgress} reports go. */
export type CacheRefreshProgressHandler = (event: CacheRefreshEvent) => void

/** Options every bulk-cache entry point accepts. */
export interface PreloadCacheOptions {
  /** Called for each step of the refresh. Absent means "report nothing". */
  onProgress?: CacheRefreshProgressHandler
  /**
   * Cancel the refresh. Honoured while downloading and ingesting — the bulk
   * download is aborted and the run throws a `CancelledError` — but never once
   * the cache file is being written: the cache is replaced atomically, so a
   * cancelled refresh always leaves the previous cache exactly as it was, and
   * the cache lock is released on the way out.
   */
  signal?: AbortSignal
}
