import { Command } from 'commander'
import path from 'node:path'
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
import {
  applyNoteUpdate,
  NoteCommandError,
  parseCardIdFlag,
  resolveListSelection,
  resolveTarget,
} from './note-edit'
import { listTypeFromFlags, type ListTypeFlags } from '../resolve-list'
import type { ListType } from '../list-type'

type ClearNoteOptions = {
  cardId?: string
} & ListTypeFlags &
  Partial<ScriptingOptions>

export function registerClearNoteCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('clear-note')
      .description('Remove the note attached to a card in a deck, collection, or wanted list')
      .argument(
        '[listName]',
        'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
      )
      .argument('[cardName...]', 'Name of the card whose note should be cleared (fuzzy match)')
      .option('--deck', 'Resolve the name as a deck')
      .option('--collection', 'Resolve the name as a collection')
      .option('--wanted', 'Resolve the name as a wanted list')
      .option('--card-id <id>', 'Disambiguate by card ID (the &N suffix in list files)'),
    'text',
  ).action(
    async (listNameArg: string | undefined, cardNameParts: string[], options: ClearNoteOptions) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      const type = listTypeFromFlags(options)
      if (type === 'conflict') {
        emitError(
          'usage_error',
          'Specify only one of --deck, --collection, or --wanted.',
          scripting,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      try {
        await runClearNote(
          {
            type,
            listName: listNameArg,
            cardName: cardNameParts.join(' ').trim() || undefined,
            cardId: options.cardId,
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
  type: ListType | undefined
  listName: string | undefined
  cardName: string | undefined
  cardId: string | undefined
}

async function runClearNote(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const cardId = input.cardId !== undefined ? parseCardIdFlag(input.cardId) : undefined

  const { type, filePath } = await resolveListSelection(input.listName, input.type)
  const listSlug = path.basename(filePath, '.md')

  const target = await resolveTarget(type, filePath, { cardId, cardName: input.cardName })

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
    emitOutput(
      {
        type,
        list: listSlug,
        cardName: target.name,
        cardId: target.cardId,
        cleared: false,
        previousNote: null,
      },
      scripting,
    )
    return
  }

  const previousNote = target.note

  await applyNoteUpdate(type, filePath, target, undefined)

  await appendChangelog(filePath, listSlug, [
    createSetNoteChange(target.name, { note: '', cardId: target.cardId }),
  ])

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(`Cleared note on ${target.name}${idLabel}`, scripting)
    }
    return
  }

  emitOutput(
    {
      type,
      list: listSlug,
      cardName: target.name,
      cardId: target.cardId,
      cleared: true,
      previousNote,
    },
    scripting,
  )
}
