import { Command } from 'commander'
import { compareData } from '../i18n/collate'
import { loadListInfos, type ListInfo } from '../list/list-info'
import { LIST_TYPES, listTypeNoun } from '../list/list-type'
import type { ListTypeFlags } from '../list/resolve-list'
import { resolveListTypeFlag, addScriptingOptions } from '../cli/options'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import { displayWidth, padEndDisplay } from '../i18n/width'
import { t } from '../i18n/t'

type ListsOptions = ListTypeFlags & Partial<ScriptingOptions>

export function registerListsCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('lists')
      .description(t('help.lists.description'))
      .option('--deck', t('help.lists.deck'))
      .option('--collection', t('help.lists.collection'))
      .option('--wanted', t('help.lists.wanted')),
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
        if (!scripting.quiet) emitOutput(t('cli.lists.empty'), scripting)
        return
      }
      for (const line of formatListsTable(rows)) emitOutput(line, scripting)
      return
    }

    emitOutput(rows, scripting)
  })
}

/**
 * The text table: a heading row, then one row per list — type, display name,
 * and the file name only when some list's file name differs from its name
 * (otherwise the column would repeat the name). Padded in terminal columns,
 * not code units: a list name (or a translated type) need not be ASCII. The
 * type reads in the UI language; JSON keeps the `deck` / `collection` /
 * `wanted` token.
 */
export function formatListsTable(rows: readonly ListInfo[]): string[] {
  const showFile = rows.some((row) => row.slug !== row.name)
  const table: string[][] = [
    [
      t('cli.lists.columnType'),
      t('cli.lists.columnName'),
      ...(showFile ? [t('cli.lists.columnFile')] : []),
    ],
    ...rows.map((row) => [listTypeNoun(row.type), row.name, ...(showFile ? [row.slug] : [])]),
  ]
  const widths = table[0]!.map((_, column) =>
    Math.max(...table.map((cells) => displayWidth(cells[column] ?? ''))),
  )
  return table.map((cells) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : padEndDisplay(cell, widths[column] ?? 0),
      )
      .join('  '),
  )
}

/** Deterministic display order: deck, collection, wanted — then slug within each type. */
function sortListInfos(rows: ListInfo[]): ListInfo[] {
  return rows.toSorted(
    (a, b) =>
      LIST_TYPES.indexOf(a.type) - LIST_TYPES.indexOf(b.type) || compareData(a.slug, b.slug),
  )
}
