import { Command } from 'commander'
import { loadListInfos, type ListInfo } from '../list-info'
import { LIST_TYPES } from '../list-type'
import { type ListTypeFlags } from '../resolve-list'
import { resolveListTypeFlag } from './card-target'
import {
  addScriptingOptions,
  emitOutput,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

type ListsOptions = ListTypeFlags & Partial<ScriptingOptions>

export function registerListsCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('lists')
      .description('Enumerate every deck, collection, and wanted list')
      .option('--deck', 'Only list decks')
      .option('--collection', 'Only list collections')
      .option('--wanted', 'Only list wanted lists'),
    'text',
  ).action(async (options: ListsOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const type = resolveListTypeFlag(options, scripting)
    if (type === 'conflict') return

    const rows = sortListInfos(
      (await loadListInfos()).filter((row) => type === undefined || row.type === type),
    )

    if (scripting.output === 'text') {
      if (rows.length === 0) {
        if (!scripting.quiet) emitOutput('(no lists)', scripting)
        return
      }
      const typeWidth = Math.max(...rows.map((row) => row.type.length))
      const slugWidth = Math.max(...rows.map((row) => row.slug.length))
      for (const row of rows) {
        emitOutput(
          `${row.type.padEnd(typeWidth)}  ${row.slug.padEnd(slugWidth)}  ${row.name}`,
          scripting,
        )
      }
      return
    }

    emitOutput(rows, scripting)
  })
}

/** Deterministic display order: deck, collection, wanted — then slug within each type. */
function sortListInfos(rows: ListInfo[]): ListInfo[] {
  return rows.toSorted(
    (a, b) =>
      LIST_TYPES.indexOf(a.type) - LIST_TYPES.indexOf(b.type) || a.slug.localeCompare(b.slug, 'en'),
  )
}
