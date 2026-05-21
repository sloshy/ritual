/**
 * Argument helpers for the `bun run dev` orchestrator (`scripts/dev.ts`).
 *
 * The orchestrator owns the TTY (to catch its own `q`/Ctrl+C shortcuts) and
 * spawns the child with stdin set to `ignore`. The child therefore can't read
 * keyboard input, so the Scryfall cache refresh prompt it would issue is
 * unanswerable. To avoid that dead end, the dev tool requires the caller to
 * pre-answer it with an explicit `--*-refresh` flag and fails fast otherwise.
 */

/** Flags that pre-answer the underlying command's cache refresh prompt. */
export const ANSWER_FLAGS: readonly string[] = [
  '--allow-refresh',
  '--allow-refresh-no-bulk',
  '--no-refresh',
]

/** Whether the passthrough args contain an explicit refresh answer. */
export function hasAnswerFlag(args: readonly string[]): boolean {
  return args.some((arg) => ANSWER_FLAGS.includes(arg))
}

/** The error shown when a prompting subcommand is run without an answer flag. */
export function answerFlagRequiredMessage(subcommand: string): string {
  return [
    `[dev] '${subcommand}' can prompt to refresh the Scryfall card cache, but the dev`,
    `      tool owns the terminal so the child can't read your answer. Re-run with an`,
    `      explicit refresh choice:`,
    ``,
    `        bun run dev ${subcommand} --allow-refresh          # refresh, bulk download allowed`,
    `        bun run dev ${subcommand} --allow-refresh-no-bulk  # refresh per-card, no bulk download`,
    `        bun run dev ${subcommand} --no-refresh             # don't refresh; use existing cache`,
  ].join('\n')
}
