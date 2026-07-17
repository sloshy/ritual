import { Command, InvalidArgumentError } from 'commander'
import { getErrorMessage } from '../errors'
import { loadExportEntries } from '../export/entries'
import {
  diffLists,
  isDiffBy,
  isListDiffEmpty,
  loadDiffListRef,
  type DiffBy,
  type DiffListRef,
  type DiffMatch,
  type DiffOnly,
  type DiffPrinting,
  type ListDiffResult,
} from '../list-diff'
import {
  isResolveListError,
  parseListArgument,
  resolveList,
  type ListLocation,
  type ResolveListError,
} from '../resolve-list'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  emitResolveListError,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

type DiffCommandOptions = {
  by: DiffBy
} & Partial<ScriptingOptions>

/** The JSON body a successful diff emits (mirrored by `GET /api/diff`). */
type DiffCommandResult = {
  a: DiffListRef
  b: DiffListRef
  by: DiffBy
  matches: DiffMatch[]
  onlyInA: DiffOnly[]
  onlyInB: DiffOnly[]
  warnings: string[]
}

/** Commander argParser for `--by`: only the two identity modes. */
function parseByFlag(value: string): DiffBy {
  const normalized = value.toLowerCase()
  if (isDiffBy(normalized)) return normalized
  throw new InvalidArgumentError(`Invalid mode '${value}'. Use 'name' or 'printing'.`)
}

/**
 * Report a failed side resolution. Ambiguity gets a diff-specific message: the
 * command takes two list arguments, so the usual `--deck`/`--collection`/
 * `--wanted` flags cannot disambiguate one side — the `type:` prefix can.
 */
function emitDiffResolveError(error: ResolveListError, scripting: ScriptingOptions): void {
  if (error.kind === 'ambiguous') {
    const lines = error.matches.map((m) => `  - ${m.type}: ${m.name}`).join('\n')
    const hints = error.matches.map((m) => `${m.type}:${error.query}`).join(' or ')
    emitError(
      'usage_error',
      `'${error.query}' is ambiguous — it matches multiple lists:\n${lines}\n` +
        `Disambiguate with a type prefix, e.g. ${hints}.`,
      scripting,
    )
    process.exitCode = ExitCode.UsageError
    return
  }
  emitResolveListError(error, scripting)
}

async function resolveSide(
  raw: string,
  scripting: ScriptingOptions,
): Promise<ListLocation | undefined> {
  const arg = parseListArgument(raw)
  const resolved = await resolveList(arg.name, arg.type)
  if (isResolveListError(resolved)) {
    emitDiffResolveError(resolved, scripting)
    return undefined
  }
  return resolved
}

/** Labels for the two sides in text output; falls back to `type:slug` on a name collision. */
type SideLabels = { a: string; b: string }

function sideLabels(a: DiffListRef, b: DiffListRef): SideLabels {
  if (a.name === b.name) {
    return { a: `${a.type}:${a.slug}`, b: `${b.type}:${b.slug}` }
  }
  return { a: a.name, b: b.name }
}

/** `(SET:number)` / `[finish]` suffix for one printing bucket; empty for a plain unpinned nonfoil. */
function printingSuffix(printing: DiffPrinting | undefined): string {
  if (!printing) return ''
  let suffix = ''
  if (printing.set) {
    const number = printing.collectorNumber ? `:${printing.collectorNumber}` : ''
    suffix += ` (${printing.set.toUpperCase()}${number})`
  }
  if (printing.finish !== 'nonfoil') suffix += ` [${printing.finish}]`
  return suffix
}

/** A single printing bucket rendered inside a name-mode breakdown, e.g. `LEA:161 x2`. */
function printingBreakdownItem(printing: DiffPrinting): string {
  const base = printing.set
    ? `${printing.set.toUpperCase()}${printing.collectorNumber ? `:${printing.collectorNumber}` : ''}`
    : 'no printing'
  const finish = printing.finish === 'nonfoil' ? '' : ` [${printing.finish}]`
  return `${base}${finish} x${printing.quantity}`
}

/** Whether a side's printings are just "one unpinned nonfoil bucket" (no breakdown needed). */
function isPlainBucket(printings: DiffPrinting[]): boolean {
  const only = printings[0]
  return (
    printings.length === 1 &&
    only !== undefined &&
    only.set === undefined &&
    only.finish === 'nonfoil'
  )
}

function formatOnlyLine(only: DiffOnly, by: DiffBy): string {
  if (by === 'printing') {
    // Printing mode: the identity is a single printing bucket.
    return `  ${only.quantity} ${only.name}${printingSuffix(only.printings[0])}`
  }
  const breakdown = isPlainBucket(only.printings)
    ? ''
    : ` (${only.printings.map(printingBreakdownItem).join(', ')})`
  return `  ${only.quantity} ${only.name}${breakdown}`
}

function formatMismatchLine(match: DiffMatch, by: DiffBy, labels: SideLabels): string {
  const identity =
    by === 'printing' ? `${match.name}${printingSuffix(match.a.printings[0])}` : match.name
  return `  ${identity}: ${match.a.quantity} in ${labels.a}, ${match.b.quantity} in ${labels.b}`
}

/** Render the human-readable diff: the three sections, or the identical-lists line. */
export function renderTextDiff(a: DiffListRef, b: DiffListRef, result: ListDiffResult): string {
  if (isListDiffEmpty(result)) {
    return `Lists are identical by ${result.by}.`
  }

  const labels = sideLabels(a, b)
  const mismatches = result.matches.filter((m) => m.a.quantity !== m.b.quantity)
  const sections: string[] = []

  if (result.onlyInA.length > 0) {
    sections.push(
      [
        `Only in ${labels.a} (${result.onlyInA.length})`,
        ...result.onlyInA.map((only) => formatOnlyLine(only, result.by)),
      ].join('\n'),
    )
  }
  if (result.onlyInB.length > 0) {
    sections.push(
      [
        `Only in ${labels.b} (${result.onlyInB.length})`,
        ...result.onlyInB.map((only) => formatOnlyLine(only, result.by)),
      ].join('\n'),
    )
  }
  if (mismatches.length > 0) {
    sections.push(
      [
        `Different quantities (${mismatches.length})`,
        ...mismatches.map((match) => formatMismatchLine(match, result.by, labels)),
      ].join('\n'),
    )
  }

  return sections.join('\n\n')
}

async function runDiff(
  rawA: string,
  rawB: string,
  by: DiffBy,
  scripting: ScriptingOptions,
): Promise<void> {
  const locationA = await resolveSide(rawA, scripting)
  if (!locationA) return
  const locationB = await resolveSide(rawB, scripting)
  if (!locationB) return

  const [refA, refB] = await Promise.all([loadDiffListRef(locationA), loadDiffListRef(locationB)])
  const [sideA, sideB] = await Promise.all([
    loadExportEntries([locationA]),
    loadExportEntries([locationB]),
  ])
  const warnings = [...sideA.warnings, ...sideB.warnings]
  const result = diffLists(sideA.entries, sideB.entries, by)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      for (const warning of warnings) process.stderr.write(`⚠️  ${warning}\n`)
    }
    emitOutput(renderTextDiff(refA, refB, result), scripting)
    return
  }

  const body: DiffCommandResult = {
    a: refA,
    b: refB,
    by: result.by,
    matches: result.matches,
    onlyInA: result.onlyInA,
    onlyInB: result.onlyInB,
    warnings,
  }
  emitOutput(body, scripting)
}

export function registerDiffCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('diff')
      .description('Compare two lists by card name or exact printing')
      .argument('<listA>', 'First list; an optional deck:/collection:/wanted: prefix pins the type')
      .argument(
        '<listB>',
        'Second list; an optional deck:/collection:/wanted: prefix pins the type',
      )
      .option('--by <mode>', "Identity to compare by: 'name' or 'printing'", parseByFlag, 'name'),
    'text',
  ).action(async (rawA: string, rawB: string, options: DiffCommandOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    try {
      // A diff with differences is still a successful diff: exit code 0 either way.
      await runDiff(rawA, rawB, options.by, scripting)
    } catch (e) {
      emitError('runtime_error', getErrorMessage(e), scripting, e)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
