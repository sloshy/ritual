/**
 * Loaded by `bun test` (bunfig.toml `[test].preload`) before any suite runs.
 *
 * The Archidekt client paces requests 500ms apart by default, and that default
 * also applies when a suite stubs `globalThis.fetch` or injects a transport —
 * where the pacing would only slow tests down. Force it off unconditionally
 * (even over a value inherited from the shell — a paced test suite is never
 * intended); suites that test the pacing itself pass an explicit
 * `minRequestIntervalMs`, which beats the environment.
 */
process.env.RITUAL_ARCHIDEKT_MIN_INTERVAL_MS = '0'
