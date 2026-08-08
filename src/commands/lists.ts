import { Command } from 'commander'
import { compareData } from '../i18n/collate'
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
      // Terminal columns, not code units — a slug is ASCII but a list name is
      // not, and the same padding helper is what keeps every table honest.
      const typeWidth = Math.max(...rows.map((row) => displayWidth(row.type)))
      const slugWidth = Math.max(...rows.map((row) => displayWidth(row.slug)))
      for (const row of rows) {
        emitOutput(
          `${padEndDisplay(row.type, typeWidth)}  ${padEndDisplay(row.slug, slugWidth)}  ${row.name}`,
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
      LIST_TYPES.indexOf(a.type) - LIST_TYPES.indexOf(b.type) || compareData(a.slug, b.slug),
  )
}
