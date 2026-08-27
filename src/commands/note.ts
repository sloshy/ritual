import { Command, Option } from 'commander'
import path from 'node:path'
import { ask } from '../cli/prompts'
import { createSetNoteChange } from '../changes/change-event'
import { applyTargetedChanges } from '../list/line-mutate'
import {
  addDryRunOption,
  addScriptingOptions,
  type DryRunOptions,
  addListTypeFlags,
  parseCardIdFlag,
  resolveListTypeFlag,
  type CardCommandResultBase,
} from '../cli/options'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import { ExitCode, CardCommandError, localizedCommandError } from '../util/errors'
import { normalizeNote } from '../card/note-helpers'
import { requireInteractive } from '../util/no-input'
import { t } from '../i18n/t'
import { resolveListSelection, resolveTarget } from './card-target'
import type { EntryRef } from '../list/entry-ref'
import { cancelledError, runCommandAction } from '../cli/action'
import { type ListTypeFlags } from '../list/resolve-list'
import type { ListType } from '../list/list-type'

type NoteOptions = {
  note?: string
  clear?: boolean
  cardId?: string
} & ListTypeFlags &
  DryRunOptions &
  Partial<ScriptingOptions>

export function registerNoteCommand(program: Command): void {
  addScriptingOptions(
    // Long form only: `-n` is already this command's `--note`.
    addDryRunOption(
      addListTypeFlags(
        program
          .command('note')
          .description(t('help.note.description'))
          .argument('[listName]', t('help.listArg.crossType'))
          .argument('[cardName...]', t('help.note.cardName')),
      )
        .addOption(new Option('-n, --note <text>', t('help.note.note')).conflicts('clear'))
        .addOption(new Option('--clear', t('help.note.clear')).conflicts('note'))
        .option('--card-id <id>', t('help.cardId.disambiguate')),
      t('help.note.dryRun'),
      { short: false },
    ),
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
      emitOutput(
        t('cli.note.set', {
          mode: input.dryRun ? 'preview' : 'done',
          name: target.name,
          id: cardIdLabel(target),
          note: noteText,
        }),
        scripting,
      )
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
  // Idempotent: if the card already has no note, succeed without rewriting the
  // file or appending a changelog entry. Scripting clients can detect this from
  // the `previousNote: null` field in the JSON output.
  if (target.note === undefined || target.note === '') {
    if (scripting.output === 'text') {
      if (!scripting.quiet) {
        emitOutput(
          t('cli.note.nothingToClear', {
            mode: dryRun ? 'preview' : 'done',
            name: target.name,
            id: cardIdLabel(target),
          }),
          scripting,
        )
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
      emitOutput(
        t('cli.note.cleared', {
          mode: dryRun ? 'preview' : 'done',
          name: target.name,
          id: cardIdLabel(target),
        }),
        scripting,
      )
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

/**
 * The ` &N` suffix a card's line carries, or the empty string. Attached to the
 * preceding token with no space of its own, so a translator keeps it next to
 * the card name it identifies.
 */
function cardIdLabel(target: EntryRef): string {
  return target.cardId !== undefined ? ` &${target.cardId}` : ''
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

  const note = await ask<string>({
    type: 'text',
    message: existingNote
      ? t('cli.note.promptReplace', { current: existingNote })
      : t('cli.note.promptText'),
    initial: existingNote ?? '',
  })
  if (note === undefined) throw cancelledError()
  return validateOrThrow(note)
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
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.note.emptyNote')
  }
  return result.note
}
