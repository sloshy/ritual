import { Command } from 'commander'
import prompts from 'prompts'
import path from 'node:path'
import type { PromptState } from './prompts-types'
import { appendChangelog } from '../changelog-writer'
import { createSetNoteChange } from '../change-event'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { normalizeNote } from '../note-helpers'
import {
  applyNoteUpdate,
  NoteCommandError,
  parseCardIdFlag,
  resolveListPath,
  resolveTarget,
  resolveType,
} from './note-edit'

type AddNoteOptions = {
  note?: string
  cardId?: string
  overwrite?: boolean
} & Partial<ScriptingOptions>

export function registerAddNoteCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('add-note')
      .description('Add or replace a note on a card in a deck, collection, or wanted list')
      .argument('[type]', 'Target type: "deck", "collection", or "wanted"')
      .argument(
        '[targetName]',
        'Name of the deck, collection, or wanted list (file name without extension)',
      )
      .argument('[cardName...]', 'Name of the card to attach a note to (fuzzy match)')
      .option('-n, --note <text>', 'Note text. If omitted, you will be prompted.')
      .option('--card-id <id>', 'Disambiguate by card ID (the &N suffix in list files)')
      .option('--overwrite', 'Replace an existing note instead of failing', false),
    'text',
  ).action(
    async (
      typeArg: string | undefined,
      targetNameArg: string | undefined,
      cardNameParts: string[],
      options: AddNoteOptions,
    ) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      try {
        await runAddNote(
          {
            type: typeArg,
            listName: targetNameArg,
            cardName: cardNameParts.join(' ').trim() || undefined,
            note: options.note,
            cardId: options.cardId,
            overwrite: options.overwrite ?? false,
          },
          scripting,
        )
      } catch (err) {
        if (err instanceof NoteCommandError) {
          emitError(err.code, err.message, scripting, err.details)
          process.exitCode = err.exitCode
          return
        }
        throw err
      }
    },
  )
}

type RunInput = {
  type: string | undefined
  listName: string | undefined
  cardName: string | undefined
  note: string | undefined
  cardId: string | undefined
  overwrite: boolean
}

async function runAddNote(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  const type = await resolveType(input.type)
  const filePath = await resolveListPath(type, input.listName)
  const listSlug = path.basename(filePath, '.md')

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })

  if (target.note && !input.overwrite) {
    throw new NoteCommandError(
      'usage_error',
      `Card '${target.name}' already has a note: "${target.note}". Pass --overwrite to replace it.`,
      ExitCode.UsageError,
      { existingNote: target.note, cardId: target.cardId },
    )
  }

  const noteText = await resolveNoteText(input.note, target.note)

  await applyNoteUpdate(type, filePath, target, noteText)

  await appendChangelog(filePath, listSlug, [
    createSetNoteChange(target.name, { note: noteText, cardId: target.cardId }),
  ])

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      const idLabel = target.cardId !== undefined ? ` &${target.cardId}` : ''
      emitOutput(`Set note on ${target.name}${idLabel} to "${noteText}"`, scripting)
    }
    return
  }

  emitOutput(
    {
      type,
      list: listSlug,
      cardName: target.name,
      cardId: target.cardId,
      note: noteText,
      previousNote: target.note,
    },
    scripting,
  )
}

// ── Note text resolution ──────────────────────────────────────────────────────

async function resolveNoteText(
  flagValue: string | undefined,
  existingNote: string | undefined,
): Promise<string> {
  if (flagValue !== undefined) return validateOrThrow(flagValue, existingNote)

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
    throw new NoteCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  return validateOrThrow(resp.note, existingNote)
}

/**
 * Validate a user-supplied note for `add-note`. Empty notes are rejected here —
 * the message points to `clear-note` only when there's actually an existing note
 * to remove (otherwise the suggestion is irrelevant).
 */
function validateOrThrow(raw: string, existingNote: string | undefined): string {
  const result = normalizeNote(raw)
  if (!result.ok) {
    throw new NoteCommandError('usage_error', result.error, ExitCode.UsageError)
  }
  if (result.note === '') {
    const suffix = existingNote ? ' Use `clear-note` to remove the existing note.' : ''
    throw new NoteCommandError(
      'usage_error',
      `Note text cannot be empty.${suffix}`,
      ExitCode.UsageError,
    )
  }
  return result.note
}
