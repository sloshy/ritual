/**
 * File-watch predicates for the `bun run dev` orchestrator (`scripts/dev.ts`).
 *
 * Extracted as pure functions so the restart-trigger logic can be unit tested
 * without spawning processes or touching the filesystem.
 */
import path from 'node:path'

/** Hand-edited source file types whose changes should restart the child. */
function isWatchedSource(filename: string): boolean {
  return (
    filename.endsWith('.ts') ||
    filename.endsWith('.tsx') ||
    filename.endsWith('.css') ||
    filename.endsWith('.svg')
  )
}

/**
 * `build` writes its generated artifacts back into `src/` (compiled CSS/JS and
 * everything under `src/generated/`). Those are not hand-edited sources — left
 * unfiltered, any `bun run build` (e.g. from `bun run precommit`) would look
 * like a flurry of source edits and trigger spurious restarts.
 */
function isGeneratedAsset(filename: string): boolean {
  const normalized = filename.split(path.sep).join('/')
  return (
    normalized.endsWith('.compiled.css') ||
    normalized.endsWith('.compiled.js') ||
    normalized === 'generated' ||
    normalized.startsWith('generated/') ||
    normalized.includes('/generated/')
  )
}

/** Whether a change to `filename` (relative to `src/`) should restart the child. */
export function shouldRestartForSource(filename: string): boolean {
  return isWatchedSource(filename) && !isGeneratedAsset(filename)
}
