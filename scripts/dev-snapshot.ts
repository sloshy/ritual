/**
 * Watched-tree snapshots for the `bun run dev` orchestrator (`scripts/dev.ts`).
 *
 * `fs.watch` can silently drop events under bursts — a formatter touching many
 * files, an editor "save all", or atomic-rename saves — which leaves the rebuilt
 * site stale ("might not catch all the changes"). To guarantee the build
 * converges on the final file state, the orchestrator periodically snapshots the
 * watched files and rebuilds whenever the current snapshot differs from the one
 * the last build was launched against.
 *
 * `diffSnapshots` is pure so the reconciliation decision can be unit tested
 * without spawning processes.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** Absolute file path -> a cheap change-detection token (`mtimeNs:size:ino`). */
export type TreeSnapshot = Map<string, string>

/** A directory to scan plus a predicate run on each path relative to `dir`. */
export type WatchRoot = {
  dir: string
  include: (relativePath: string) => boolean
}

/**
 * Walk each root recursively and record a change-detection token for every
 * included file. The whole convergence guarantee rests on this token catching
 * every real change, so it uses nanosecond mtime (millisecond `mtimeMs` would
 * collide on two writes within the same ms) plus size, plus the inode so an
 * atomic-rename save is detected even if it lands an identical mtime and size.
 */
export function snapshotTree(roots: readonly WatchRoot[]): TreeSnapshot {
  const snapshot: TreeSnapshot = new Map()
  for (const root of roots) {
    let entries: string[]
    try {
      entries = readdirSync(root.dir, { recursive: true, encoding: 'utf8' })
    } catch {
      continue // root may not exist (e.g. an absent data dir) — skip it
    }
    for (const entry of entries) {
      const relative = entry.split(path.sep).join('/')
      if (!root.include(relative)) continue
      const absolute = path.join(root.dir, entry)
      try {
        const stat = statSync(absolute, { bigint: true })
        if (!stat.isFile()) continue
        snapshot.set(absolute, `${stat.mtimeNs}:${stat.size}:${stat.ino}`)
      } catch {
        // Raced with a delete between readdir and stat — treat as absent.
      }
    }
  }
  return snapshot
}

/** Absolute paths that were added, removed, or whose token changed. */
export function diffSnapshots(prev: TreeSnapshot, next: TreeSnapshot): string[] {
  const changed: string[] = []
  for (const [file, token] of next) {
    if (prev.get(file) !== token) changed.push(file)
  }
  for (const file of prev.keys()) {
    if (!next.has(file)) changed.push(file)
  }
  return changed
}
