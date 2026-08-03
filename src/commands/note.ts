import { Command, Option } from 'commander'
import prompts from 'prompts'
import path from 'node:path'
import type { PromptState } from './prompts-types'
import { createSetNoteChange } from '../change-event'
import { applyTargetedChanges } from './line-mutate'
import {
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type DryRunOptions,
  type ScriptingOptions,
} from './scripting'
import { normalizeNote } from '../note-helpers'
import { requireInteractive } from '../no-input'
import { CardCommandError } from '../errors'
import {
  parseCardIdFlag,
  resolveListSelection,
  resolveListTypeFlag,
  resolveTarget,
  runCommandAction,
  type CardCommandResultBase,
  type EntryRef,
} from './card-target'
import { type ListTypeFlags } from '../resolve-list'
import type { ListType } from '../list-type'

type NoteOptions = {
  note?: string
  clear?: boolean
  cardId?: string
} & ListTypeFlags &
  DryRunOptions &
  Partial<ScriptingOptions>

export function registerNoteCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('note')
      .description(
        'Set, replace, or clear the note on a card in a deck, collection, or wanted list',
      )
      .argument(
        '[listName]',
        'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
      )
      .argument('[cardName...]', 'Name of the card whose note to set or clear (fuzzy match)')
      .option('--deck', 'Resolve the name as a deck')
      .option('--collection', 'Resolve the name as a collection')
      .option('--wanted', 'Resolve the name as a wanted list')
      .addOption(
        new Option(
          '-n, --note <text>',
          'Note text (replaces any existing note). If omitted, you will be prompted.',
        ).conflicts('clear'),
      )
      .addOption(new Option('--clear', 'Remove the note from the card').conflicts('note'))
      .option('--card-id <id>', 'Disambiguate by card ID (the &N suffix in list files)')
      // Long form only: `-n` is already this command's `--note`, and the shared
      // `addDryRunOption` would claim it.
      .option('--dry-run', 'Report what the note would become without writing anything'),
    'text',
  ).action(
    async (listNameArg: string | undefined, cardNameParts: string[], options: NoteOptions) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      const type = resolveListTypeFlag(options, scripting)
      if (type === 'conflict') return
      await runCommandAction(scripting, () =>
        runNote(
          {
            type,
            listName: listNameArg,
            cardName: cardNameParts.join(' ').trim() || undefined,
            note: options.note,
            clear: options.clear ?? false,
            cardId: options.cardId,
            dryRun: options.dryRun ?? false,
          },
          scripting,
        ),
      )
    },
  )
}

type RunInput = {
  type: ListType | undefined
  listName: string | undefined
  cardName: string | undefined
  note: string | undefined
  clear: boolean
  cardId: string | undefined
  dryRun: boolean
}

type NoteSetResult = CardCommandResultBase & {
  note: string
  previousNote: string | undefined
  /** Present and true when `--dry-run` reported the note without writing it. */
  dryRun?: true
}

type NoteClearResult = CardCommandResultBase & {
  /** Present and true when `--dry-run` reported the clear without performing it. */
  dryRun?: true
  cleared: boolean
  /** The removed note, or null when there was nothing to clear (idempotent no-op). */
  previousNote: string | null
}

/**
 * Persist a note value (`''` clears) onto the target card. All three list
 * types go through the line-preserving apply path, which rewrites only the
 * target's line and appends the changelog in the same call.
 */
async function persistNote(
  type: ListType,
  filePath: string,
  target: EntryRef,
  noteText: string,
): Promise<void> {
  await applyTargetedChanges(type, filePath, target, [
    createSetNoteChange(target.name, { note: noteText, cardId: target.cardId }),
  ])
}

async function runNote(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const listSlug = path.basename(filePath, '.md')

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })

  if (input.clear) {
    await runClear(type, filePath, listSlug, target, scripting, input.dryRun)
    return
  }

  const noteText = await resolveNoteText(input.note, target.note)

  // A dry run resolves the list, the target, and the note text, then stops
  // before the first write: no list file, no changelog, no sidecar.
  if (!input.dryRun) await persistNote(type, filePath, target, noteText)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      const idLabel = target.cardId !== undefined ? ` &${target.cardId}` : ''
      const prefix = input.dryRun ? '[dry-run] Would set' : 'Set'
      emitOutput(`${prefix} note on ${target.name}${idLabel} to "${noteText}"`, scripting)
    }
    return
  }

  const result: NoteSetResult = {
    ...(input.dryRun ? { dryRun: true as const } : {}),
    type,
    list: listSlug,
    cardName: target.name,
    cardId: target.cardId,
    note: noteText,
    previousNote: target.note,
  }
  emitOutput(result, scripting)
}

// ── Clearing ──────────────────────────────────────────────────────────────────

async function runClear(
  type: ListType,
  filePath: string,
  listSlug: string,
  target: EntryRef,
  scripting: ScriptingOptions,
  dryRun: boolean,
): Promise<void> {
  const idLabel = target.cardId !== undefined ? ` &${target.cardId}` : ''

  // Idempotent: if the card already has no note, succeed without rewriting the
  // file or appending a changelog entry. Scripting clients can detect this from
  // the `previousNote: null` field in the JSON output.
  if (target.note === undefined || target.note === '') {
    if (scripting.output === 'text') {
      if (!scripting.quiet) {
        const prefix = dryRun ? '[dry-run] ' : ''
        emitOutput(`${prefix}No note on ${target.name}${idLabel}; nothing to clear.`, scripting)
      }
      return
    }
    const noop: NoteClearResult = {
      ...(dryRun ? { dryRun: true as const } : {}),
      type,
      list: listSlug,
      cardName: target.name,
      cardId: target.cardId,
      cleared: false,
      previousNote: null,
    }
    emitOutput(noop, scripting)
    return
  }

  const previousNote = target.note

  if (!dryRun) await persistNote(type, filePath, target, '')

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      const prefix = dryRun ? '[dry-run] Would clear' : 'Cleared'
      emitOutput(`${prefix} note on ${target.name}${idLabel}`, scripting)
    }
    return
  }

  const result: NoteClearResult = {
    ...(dryRun ? { dryRun: true as const } : {}),
    type,
    list: listSlug,
    cardName: target.name,
    cardId: target.cardId,
    cleared: true,
    previousNote,
  }
  emitOutput(result, scripting)
}

// ── Note text resolution ──────────────────────────────────────────────────────

async function resolveNoteText(
  flagValue: string | undefined,
  existingNote: string | undefined,
): Promise<string> {
  if (flagValue !== undefined) return validateOrThrow(flagValue)

  // The note-text prompt is only available interactively — a run without a
  // terminal, or with prompts disabled via --no-input, must say what to pass.
  requireInteractive('--note <text> or --clear')

  let exited = false
  const resp = await prompts({
    type: 'text',
    name: 'note',
    message: existingNote ? `Replace note (current: "${existingNote}"):` : 'Note text:',
    initial: existingNote ?? '',
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.note !== 'string') {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  return validateOrThrow(resp.note)
}

/**
 * Validate a user-supplied note. Empty (or whitespace-only) notes are rejected
 * here — clearing is an explicit action via `--clear`, not an empty set.
 */
function validateOrThrow(raw: string): string {
  const result = normalizeNote(raw)
  if (!result.ok) {
    throw new CardCommandError('usage_error', result.error, ExitCode.UsageError)
  }
  if (result.note === '') {
    throw new CardCommandError(
      'usage_error',
      'Note text cannot be empty. Use --clear to remove a note.',
      ExitCode.UsageError,
    )
  }
  return result.note
}
