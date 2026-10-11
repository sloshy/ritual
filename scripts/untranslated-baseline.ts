#!/usr/bin/env bun
/**
 * Maintain `eslint-rules/untranslated-baseline.json`, the ratchet that lets
 * `ritual/no-untranslated-literal` cover all of `src/` before every string in
 * it is converted.
 *
 *   bun run scripts/untranslated-baseline.ts            # prune
 *   bun run scripts/untranslated-baseline.ts --guard    # fail if it grew vs HEAD
 *   bun run scripts/untranslated-baseline.ts --guard --staged
 *
 * **Prune** (the routine use, after converting strings to `t()`): re-scan `src/`
 * and rewrite the baseline with every entry clamped to what the code still
 * contains — converted strings drop out, entries for deleted files drop out, a
 * file git reports as renamed carries its entries to its new path, and nothing
 * is added. Uncovered text is listed and the script exits 1.
 *
 * **Guard** (run by `scripts/precommit.ts` in every mode): compare the baseline
 * — the working copy, or the index with `--staged` — against `HEAD`, following
 * git's renames, and fail if any entry's count went up.
 *
 * Growth is allowed only with `RITUAL_ADMIT_UNTRANSLATED_REKEY=1`, which
 * `--admit-new-debt` also requires. AGENTS.md reserves both for the commit that
 * changes the rule's heuristics, to re-key existing debt — never to land new
 * untranslated text.
 */
import { ESLint } from 'eslint'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import {
  ADMIT_REKEY_ENV,
  BASELINE_FILE,
  SKIP_CHECK_ENV,
  baselineGrowth,
  isLintable,
  parseBaseline,
  parseRenames,
  pruneBaseline,
  splitBaseline,
  type Baseline,
} from '../eslint-rules/untranslated-baseline.js'

const ROOT = path.resolve(import.meta.dir, '..')
const BASELINE_PATH = path.join(ROOT, BASELINE_FILE)
const RULE_ID = 'ritual/no-untranslated-literal'
/** How many grown entries the guard prints before summarising the rest. */
const GROWTH_LISTED = 40

/** Run git in the repo; null when it fails (no `HEAD` yet, file absent at a revision). */
function git(args: string[]): string | null {
  const result = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  return result.exitCode === 0 ? result.stdout.toString() : null
}

function parseOrExit(raw: string, label: string): Baseline {
  const parsed = parseBaseline(raw)
  if (typeof parsed === 'string') {
    console.error(`${label} is malformed: ${parsed}`)
    process.exit(1)
  }
  return parsed
}

/** Renames since `HEAD`: staged only, or staged and unstaged together. */
function renamesSinceHead(staged: boolean): Record<string, string> {
  const args = staged
    ? ['diff', '--cached', '--name-status', '-M', 'HEAD']
    : ['diff', '--name-status', '-M', 'HEAD']
  return parseRenames(git(args) ?? '')
}

/** Every untranslated occurrence under `src/`, keyed like the baseline. */
async function scan(): Promise<Baseline> {
  // The lint config refuses to load while the baseline names a deleted file —
  // exactly the state this script repairs — so the check is off for the scan.
  process.env[SKIP_CHECK_ENV] = '1'
  const eslint = new ESLint({
    cwd: ROOT,
    ruleFilter: ({ ruleId }) => ruleId === RULE_ID,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        // The rule is syntactic; skipping the type-aware program makes the scan fast.
        languageOptions: { parserOptions: { projectService: false, project: null } },
        rules: { [RULE_ID]: ['error', { root: ROOT, collect: true }] },
      },
    ],
  })
  const found: Baseline = {}
  for (const result of await eslint.lintFiles(['src'])) {
    const file = path.relative(ROOT, result.filePath).split(path.sep).join('/')
    for (const message of result.messages) {
      if (message.ruleId !== RULE_ID) {
        throw new Error(`${file}:${message.line}: ${message.message}`)
      }
      const entries = (found[file] ??= {})
      entries[message.message] = (entries[message.message] ?? 0) + 1
    }
  }
  return found
}

async function prune(admit: boolean): Promise<void> {
  if (admit && process.env[ADMIT_REKEY_ENV] !== '1') {
    console.error(
      `--admit-new-debt also needs ${ADMIT_REKEY_ENV}=1. It re-keys the baseline in the commit ` +
        'that changes the rule — it never admits new untranslated text (AGENTS.md "Localization").',
    )
    process.exit(1)
  }
  const parsed = parseOrExit(await readFile(BASELINE_PATH, 'utf8'), BASELINE_FILE)
  const { kept, orphans } = splitBaseline(parsed, (file) => isLintable(ROOT, file))
  const result = pruneBaseline(kept, await scan(), {
    admit,
    orphans,
    renames: renamesSinceHead(false),
  })

  await writeFile(BASELINE_PATH, `${JSON.stringify(result.baseline, null, 2)}\n`)
  for (const move of result.carried) console.log(`Carried entries across a rename: ${move}`)
  console.log(`Removed ${result.removed} stale occurrence(s) from the baseline.`)

  if (result.unadmitted.length > 0) {
    console.error(
      `\n${result.unadmitted.length} untranslated string(s) are not in the baseline and were NOT added.\n` +
        'Route them through t() (see AGENTS.md "Localization"):\n',
    )
    for (const line of result.unadmitted) console.error(`  ${line}`)
    process.exit(1)
  }
}

async function guard(staged: boolean): Promise<void> {
  const committed = git(['show', `HEAD:${BASELINE_FILE}`])
  const previous = committed === null ? {} : parseOrExit(committed, `HEAD:${BASELINE_FILE}`)
  const raw = staged ? git(['show', `:${BASELINE_FILE}`]) : await readFile(BASELINE_PATH, 'utf8')
  const next = parseOrExit(raw ?? '{}', BASELINE_FILE)
  const growth = baselineGrowth(previous, next, renamesSinceHead(staged))
  if (growth.length === 0) return
  const admitted = process.env[ADMIT_REKEY_ENV] === '1'
  const log = admitted ? console.warn : console.error
  log(
    `${BASELINE_FILE} grew against HEAD:\n` +
      [
        ...growth.slice(0, GROWTH_LISTED).map((line) => `  ${line}`),
        ...(growth.length > GROWTH_LISTED ? [`  …and ${growth.length - GROWTH_LISTED} more`] : []),
      ].join('\n'),
  )
  if (admitted) {
    console.warn(`Allowed by ${ADMIT_REKEY_ENV}=1 (a rule-heuristics re-key).`)
    return
  }
  console.error(
    '\nThe baseline only shrinks: route the new text through t() instead (AGENTS.md "Localization").',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.includes('--guard')) await guard(args.includes('--staged'))
else await prune(args.includes('--admit-new-debt'))
