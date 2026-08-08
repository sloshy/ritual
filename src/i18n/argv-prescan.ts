/**
 * A tolerant pre-scan of `process.argv` for the two global options the i18n
 * boot needs *before* Commander exists.
 *
 * Commander evaluates every `.description()` / `.option()` / `.argument()`
 * string at registration time, so a locale resolved in `preAction` arrives
 * after `--help` has already rendered. `buildProgram()` therefore runs after
 * `initI18n()`, and `initI18n()` has no parsed options to read — hence this.
 *
 * It **never validates and never throws**: `preAction` remains the
 * authoritative validator, so a malformed `--locale` still produces the usual
 * exit-2 usage error, only later. A value this scan misreads can at worst
 * render help in the wrong language; it can never change what a command does.
 *
 * CLI-only.
 */

/** The options the boot sequence pre-scans for. */
export type PrescannedArgs = {
  locale?: string
  baseDir?: string
}

/** Long options recognized here, mapped to the field they fill. */
const SCANNED: Record<string, keyof PrescannedArgs> = {
  '--locale': 'locale',
  '--base-dir': 'baseDir',
}

/**
 * Scan raw argv for `--locale` / `--base-dir` in both `--x v` and `--x=v`
 * forms. The last occurrence wins, matching Commander. Everything after a bare
 * `--` is an operand and is ignored.
 */
export function prescanArgs(argv: readonly string[]): PrescannedArgs {
  const found: PrescannedArgs = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (arg === '--') break

    const equals = arg.indexOf('=')
    if (equals > 0) {
      const field = SCANNED[arg.slice(0, equals)]
      if (field !== undefined) {
        const value = arg.slice(equals + 1).trim()
        if (value !== '') found[field] = value
      }
      continue
    }

    const field = SCANNED[arg]
    if (field === undefined) continue
    // A missing value, or a value that is plainly the next option, is left
    // unset — the real parser will report it.
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('-')) continue
    const value = next.trim()
    if (value !== '') found[field] = value
    index += 1
  }
  return found
}
