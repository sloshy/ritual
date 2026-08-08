/**
 * Scoped control of `RITUAL_I18N_STRICT` for the `t()` suites.
 *
 * `isStrictI18n()` reads `process.env` on every call so a test can flip it
 * mid-suite, which means both directions have to be set explicitly: the
 * verification harness turns strict mode **on** for the whole run
 * (`scripts/precommit.ts`, `playwright.config.ts`), so a test asserting the
 * production degradation — a missing key rendering as the key string rather
 * than throwing — has to turn it back off rather than assume it is unset.
 *
 * Both helpers restore whatever the environment had before, so they nest and
 * never leak into a neighbouring test.
 */

/** The one variable these helpers own. */
const STRICT_ENV_VAR = 'RITUAL_I18N_STRICT'

function withStrictValue(value: string | undefined, run: () => void): void {
  const previous = process.env[STRICT_ENV_VAR]
  if (value === undefined) delete process.env[STRICT_ENV_VAR]
  else process.env[STRICT_ENV_VAR] = value
  try {
    run()
  } finally {
    if (previous === undefined) delete process.env[STRICT_ENV_VAR]
    else process.env[STRICT_ENV_VAR] = previous
  }
}

/** Run `run` with missing keys and missing parameters made fatal. */
export function withStrict(run: () => void): void {
  withStrictValue('1', run)
}

/** Run `run` with the production degradation in force, whatever the harness set. */
export function withoutStrict(run: () => void): void {
  withStrictValue(undefined, run)
}
