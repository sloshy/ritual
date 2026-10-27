/**
 * Loaded by `bun test` (bunfig.toml `[test].preload`) before any suite runs.
 *
 * The Archidekt client paces requests `DEFAULT_MIN_REQUEST_INTERVAL_MS` apart
 * by default, and that default
 * also applies when a suite stubs `globalThis.fetch` or injects a transport —
 * where the pacing would only slow tests down. Force it off unconditionally
 * (even over a value inherited from the shell — a paced test suite is never
 * intended); suites that test the pacing itself pass an explicit
 * `minRequestIntervalMs`, which beats the environment.
 */

import { plugin } from 'bun'
import { afterEach, beforeEach } from 'bun:test'
import { SolidPlugin } from '@dschz/bun-plugin-solid'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import prompts from 'prompts'
import { registerCliMessages } from '../src/i18n/register/cli'

process.env.RITUAL_ARCHIDEKT_MIN_INTERVAL_MS = '0'

/**
 * Compile `.tsx` with Solid's own JSX transform. Since Bun 1.4.3, Bun's built-in
 * transpiler turns `jsxImportSource: "solid-js"` into an automatic-runtime
 * `import { jsx } from 'solid-js/jsx-runtime'`, which solid-js does not provide
 * at runtime (that export is types only), so every suite reaching a component
 * fails to link. The bundled SPAs already go through this plugin. `generate:
 * 'ssr'` because `bun test` resolves solid-js to its server build. Awaited so
 * registration has finished before any suite loads — but this file's own
 * static imports are hoisted above it, so they must never reach a `.tsx`.
 */
await plugin(SolidPlugin({ generate: 'ssr', hydratable: false, sourceMaps: 'inline' }))

/**
 * Pin the from-source version (`src/config/version.ts`) so no suite spawns
 * `git describe`. Under `--parallel`, workers run with `--isolate`, which
 * re-evaluates that module for every test file that reaches it (nearly all of
 * them, via `src/util/http.ts`): a couple of hundred `execSync` calls per run.
 *
 * Bun 1.4.2's `spawnSync` occasionally loses the child's exit there: the
 * isolated spawn-sync loop's `num_polls` drops to 0 while the child's pidfd is
 * still registered, so `us_loop_run_bun_tick` returns without polling and the
 * wait loop spins at 100% CPU forever (no syscalls, a zombie `sh` child, and
 * per-test timeouts can't fire). That was the intermittent `bun run test` hang.
 * Avoid synchronous child processes in code that unit tests reach — including
 * this file's own imports, which evaluate before this assignment. CLIs spawned
 * from source inherit it (compiled builds ignore it: `GIT_VERSION` wins).
 */
process.env.RITUAL_DEV_VERSION_REF = 'test'

/**
 * Point the per-user state file (`src/util/user-state.ts`) at a throwaway
 * directory, so no suite reads or writes the real one under the home
 * directory. Spawned CLIs inherit it; suites that test the file itself set
 * their own.
 */
process.env.RITUAL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'ritual-test-state-'))

/**
 * Register the English catalog, exactly as `main()` in `index.ts` does.
 *
 * Namespaces are import boundaries, so `t()` renders the key string
 * until a surface entry point registers its namespaces. A unit test that
 * imports a module directly never runs an entry point, so this stands in for
 * one — with the CLI's full set, because a suite may exercise any surface.
 * Tests that care about the *boundary* (which namespaces a given surface
 * registers) assert on the register modules' import graph instead; see
 * `scanRegistrationBoundaries` in `scripts/check-locales.ts`.
 */
registerCliMessages()

/**
 * Reset the `prompts` injection queue before every test. `prompts.inject` fills
 * a module-global array that the library never clears: once set, a *drained*
 * queue is still truthy, and from then on every prompt that finds the queue
 * present-but-empty resolves to its `initial` value instead of opening (or
 * being observable at all). One suite's leftover `inject` therefore poisons
 * every later suite's prompts, so the queue is unset (not emptied) here.
 */
beforeEach(() => {
  ;(prompts as unknown as { _injected?: unknown[] })._injected = undefined
})

/**
 * Clear `process.exitCode` after every test. Suites that drive a command
 * in-process leave the code the run set behind, and Bun reports a lingering
 * non-zero one as the whole run's exit code — a green suite that exits 2.
 *
 * Concretely 0, never `undefined`: Bun ignores `process.exitCode = undefined`,
 * so restoring a saved `undefined` does nothing at all. `afterEach` rather than
 * `beforeEach` because the leak that matters most is the *last* test's, which
 * no later `beforeEach` would ever clear.
 */
afterEach(() => {
  process.exitCode = 0
})
