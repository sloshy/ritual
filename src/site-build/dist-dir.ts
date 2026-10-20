/**
 * Where the static site is published, and how Ritual re-invokes itself to build
 * it.
 *
 * One owner for three facts that were previously spelled in two places each: the
 * `dist/` default, the `--out-dir` validation, and the child-process command
 * line. `build-site`, `serve --build`, and the admin build route all import from
 * here, which is what keeps `serve --build --out-dir X` serving X rather than a
 * second, hard-coded `dist/`.
 *
 * Layer-neutral on purpose — `src/admin/` importing a `src/commands/` module for
 * a path rule was the wrinkle this removes.
 */

import path from 'node:path'
import { getBaseDir } from '../config/base-dir'
import { isRunningFromSource } from '../config/runtime'
import { t } from '../i18n/t'
import { FLAG } from '../util/cli-tokens'

/** The directory a build publishes to when `--out-dir` is not given. */
export function defaultDistDir(): string {
  return path.join(getBaseDir(), 'dist')
}

/**
 * Where a build publishes, resolved from `--out-dir`. The refusal is worded in
 * the CLI's language: only `build-site` and `serve` resolve the flag, and both
 * print it to the console.
 */
export type OutDirResolution = OutDirResolved | OutDirRefused

/** The directory `--out-dir` resolved to. */
export type OutDirResolved = { ok: true; dir: string }

/** Why `--out-dir` was refused, worded in the CLI's language. */
export type OutDirRefused = { ok: false; error: string }

/**
 * Resolve `--out-dir` against the Ritual directory, defaulting to `dist/`.
 *
 * A safety boundary rather than a formatting check, and it holds for every
 * caller of the flag. A build **replaces its output directory wholesale** (it
 * writes a scratch tree and renames it over the target), so `--out-dir .` would
 * replace the user's decks, collections, and `.git` with a built site; `serve`
 * publishes that same directory over HTTP, so it would serve them instead.
 * Refused, therefore:
 *
 * - a blank value (`--out-dir ''` / whitespace), which would resolve to the base
 *   directory itself;
 * - the Ritual base directory, however it is spelled;
 * - any ancestor of the base directory, including a filesystem root — removing
 *   one takes the base directory with it.
 *
 * Everything else resolves: a relative path against the base directory, an
 * absolute path as given.
 */
export function resolveOutDir(raw: string | undefined): OutDirResolution {
  const baseDir = path.resolve(getBaseDir())
  if (raw === undefined) return { ok: true, dir: path.join(baseDir, 'dist') }

  const trimmed = raw.trim()
  if (trimmed === '')
    return { ok: false, error: t('cli.buildSite.outDirBlank', { flag: FLAG.outDir }) }

  const dir = path.resolve(baseDir, trimmed)
  if (dir === baseDir) {
    return {
      ok: false,
      error: t('cli.buildSite.outDirIsBase', { base: baseDir, flag: FLAG.outDir }),
    }
  }
  // `path.relative(dir, baseDir)` never starts with `..` when `dir` contains
  // `baseDir`, which is exactly the ancestor test (a filesystem root included).
  const fromOutDir = path.relative(dir, baseDir)
  if (fromOutDir !== '' && !fromOutDir.startsWith('..') && !path.isAbsolute(fromOutDir)) {
    return {
      ok: false,
      error: t('cli.buildSite.outDirContainsBase', { dir, base: baseDir, flag: FLAG.outDir }),
    }
  }
  return { ok: true, dir }
}

/**
 * The three process facts {@link ritualArgv} reads. Injectable so both arms are
 * testable — `Bun.main` is read-only and {@link isRunningFromSource} caches.
 */
export interface RitualArgvEnv {
  /** Whether this process runs from a source checkout rather than a compiled binary. */
  fromSource: boolean
  /** The module the process was started with (`Bun.main`). */
  main: string
  /** The running executable (`process.execPath`): `bun` in source mode, the binary otherwise. */
  execPath: string
}

/** {@link RitualArgvEnv} read off the live process. */
export function currentRitualArgvEnv(): RitualArgvEnv {
  return { fromSource: isRunningFromSource(), main: Bun.main, execPath: process.execPath }
}

/**
 * How to re-invoke this Ritual as a subprocess: `bun run <entry> …` from a
 * source checkout, the compiled binary otherwise. The old hard-coded
 * `'bun run index.ts build-site'` was wrong for a compiled binary, which has no
 * `index.ts` beside it.
 *
 * The source-mode entry point is `Bun.main` — the module the process was started
 * with, which is exactly what {@link isRunningFromSource} reads when it says this
 * is a checkout. Resolving `index.ts` against the *data* directory instead
 * assumed the Ritual directory and the checkout are the same place, which they
 * are not whenever `--base-dir` (or `RITUAL_BASE_DIR`) points elsewhere.
 */
export function ritualArgv(args: string[], env: RitualArgvEnv = currentRitualArgvEnv()): string[] {
  return env.fromSource ? [env.execPath, 'run', env.main, ...args] : [env.execPath, ...args]
}
