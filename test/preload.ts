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

import { registerCliMessages } from '../src/i18n/register/cli'

process.env.RITUAL_ARCHIDEKT_MIN_INTERVAL_MS = '0'

/**
 * Register the English catalog, exactly as `main()` in `index.ts` does.
 *
 * Namespaces are import boundaries (plan §4.2), so `t()` renders the key string
 * until a surface entry point registers its namespaces. A unit test that
 * imports a module directly never runs an entry point, so this stands in for
 * one — with the CLI's full set, because a suite may exercise any surface.
 * Tests that care about the *boundary* (which namespaces a given surface
 * registers) assert on the register modules' import graph instead; see
 * `scanRegistrationBoundaries` in `scripts/check-locales.ts`.
 */
registerCliMessages()
