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
      // Terminal columns, not code units — a slug is ASCII but a list name (or
      // a translated type) is not, and the same padding helper is what keeps
      // every table honest. The type reads in the UI language; JSON keeps the
      // `deck` / `collection` / `wanted` token.
      const types = rows.map((row) => listTypeNoun(row.type))
      const typeWidth = Math.max(...types.map(displayWidth))
      const slugWidth = Math.max(...rows.map((row) => displayWidth(row.slug)))
      rows.forEach((row, index) => {
        emitOutput(
          `${padEndDisplay(types[index] ?? '', typeWidth)}  ${padEndDisplay(row.slug, slugWidth)}  ${row.name}`,
          scripting,
        )
      })
      return
    }

    emitOutput(rows, scripting)
  })
}

/** Deterministic display order: deck, collection, wanted — then slug within each type. */
function sortListInfos(rows: ListInfo[]): ListInfo[] {
  return rows.toSorted(
    (a, b) =>
      LIST_TYPES.indexOf(a.type) - LIST_TYPES.indexOf(b.type) || compareData(a.slug, b.slug),
  )
}
