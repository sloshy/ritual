import { Command, Option } from 'commander'
import prompts from 'prompts'
import path from 'node:path'
import type { PromptState } from './prompts-types'
import { appendChangelog } from '../changelog-writer'
import { createSetNoteChange } from '../change-event'
import { applyChangesToListFile } from '../list-mutate'
import {
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { normalizeNote } from '../note-helpers'
import { applyNoteUpdate } from './note-edit'
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
      .option('--card-id <id>', 'Disambiguate by card ID (the &N suffix in list files)'),
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
}

type NoteSetResult = CardCommandResultBase & {
  note: string
  previousNote: string | undefined
}

type NoteClearResult = CardCommandResultBase & {
  cleared: boolean
  /** The removed note, or null when there was nothing to clear (idempotent no-op). */
  previousNote: string | null
}

/**
 * Persist a note value (`''` clears) onto the target card. Decks go through the
 * shared change engine, which both rewrites the file and appends the changelog;
 * flat lists keep the line-preserving rewrite in `note-edit.ts` plus an
 * explicit changelog append.
 */
async function persistNote(
  type: ListType,
  filePath: string,
  listSlug: string,
  target: EntryRef,
  noteText: string,
): Promise<void> {
  if (type === 'deck') {
    await applyChangesToListFile('deck', filePath, [
      createSetNoteChange(target.name, { note: noteText, cardId: target.cardId }),
    ])
    return
  }
  await applyNoteUpdate(type, filePath, target, noteText === '' ? undefined : noteText)
  await appendChangelog(filePath, listSlug, [
    createSetNoteChange(target.name, { note: noteText, cardId: target.cardId }),
  ])
}

async function runNote(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const listSlug = path.basename(filePath, '.md')

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })

  if (input.clear) {
    await runClear(type, filePath, listSlug, target, scripting)
    return
  }

  const noteText = await resolveNoteText(input.note, target.note)

  await persistNote(type, filePath, listSlug, target, noteText)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      const idLabel = target.cardId !== undefined ? ` &${target.cardId}` : ''
      emitOutput(`Set note on ${target.name}${idLabel} to "${noteText}"`, scripting)
    }
    return
  }

  const result: NoteSetResult = {
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
): Promise<void> {
  const idLabel = target.cardId !== undefined ? ` &${target.cardId}` : ''

  // Idempotent: if the card already has no note, succeed without rewriting the
  // file or appending a changelog entry. Scripting clients can detect this from
  // the `previousNote: null` field in the JSON output.
  if (target.note === undefined || target.note === '') {
    if (scripting.output === 'text') {
      if (!scripting.quiet) {
        emitOutput(`No note on ${target.name}${idLabel}; nothing to clear.`, scripting)
      }
      return
    }
    const noop: NoteClearResult = {
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

  await persistNote(type, filePath, listSlug, target, '')

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(`Cleared note on ${target.name}${idLabel}`, scripting)
    }
    return
  }

  const result: NoteClearResult = {
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

  if (!process.stdin.isTTY) {
    throw new CardCommandError(
      'usage_error',
      'No note given. Pass --note <text> to set a note or --clear to remove it.',
      ExitCode.UsageError,
    )
  }

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
