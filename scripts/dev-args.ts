/**
 * Argument helpers for the `bun run dev` orchestrator (`scripts/dev.ts`).
 *
 * The orchestrator owns the TTY (to catch its own `q`/Ctrl+C shortcuts) and
 * spawns the child with stdin set to `ignore`. The child therefore can't read
 * keyboard input, so the Scryfall cache refresh prompt it would issue under the
 * default `--refresh ask` is unanswerable. To avoid that dead end, the dev tool
 * requires the caller to pre-answer it — an explicit non-`ask` `--refresh`
 * mode, or `--no-input` (under which `ask` skips the refresh instead of
 * prompting) — and fails fast otherwise.
 */

import { REFRESH_MODES } from '../src/refresh'
/** `--refresh` modes that resolve without prompting. `ask` is deliberately absent. */
const ANSWERED_REFRESH_MODES: readonly string[] = REFRESH_MODES.filter((mode) => mode !== 'ask')

/**
 * The value of the last `--refresh` flag in the args (matching commander's
 * last-one-wins behavior), handling both the `--refresh <mode>` and
 * `--refresh=<mode>` spellings. Returns undefined when no `--refresh` is
 * present or the final one is missing its value.
 */
function refreshMode(args: readonly string[]): string | undefined {
  let mode: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--refresh') {
      mode = args[i + 1]
      i++ // The next token is consumed as the value, exactly as commander does.
    } else if (arg.startsWith('--refresh=')) {
      mode = arg.slice('--refresh='.length)
    }
  }
  return mode
}

/**
 * Whether the passthrough args pre-answer the child's cache refresh question:
 * an explicit `--refresh` mode other than `ask`, or `--no-input` (under which
 * the child skips the refresh rather than prompting). `--refresh ask` restates
 * the prompting default, so it does not count as an answer.
 */
export function hasAnswerFlag(args: readonly string[]): boolean {
  if (args.includes('--no-input')) return true
  const mode = refreshMode(args)
  return mode !== undefined && ANSWERED_REFRESH_MODES.includes(mode.toLowerCase())
}

/** The error shown when a prompting subcommand is run without a refresh answer. */
export function answerFlagRequiredMessage(subcommand: string): string {
  return [
    `[dev] '${subcommand}' can prompt to refresh the Scryfall card cache, but the dev`,
    `      tool owns the terminal so the child can't read your answer. Re-run with an`,
    `      explicit refresh choice:`,
    ``,
    `        bun run dev ${subcommand} --refresh auto     # refresh, bulk download allowed`,
    `        bun run dev ${subcommand} --refresh no-bulk  # refresh per-card, no bulk download`,
    `        bun run dev ${subcommand} --refresh never    # don't refresh; use existing cache`,
    ``,
    `      (--no-input also works: the child skips the refresh instead of prompting.)`,
  ].join('\n')
}
