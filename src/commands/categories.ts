import type { Command } from 'commander'
import {
  applyCategoryChangesToRecord,
  categoriesSaveTouchesDisk,
  commitCategoryChanges,
  loadCardCategories,
  orderedCategoryEntries,
  previewCategoriesSaveAction,
  removeCategoryFromRecord,
  resolveCategoryOrder,
  type CardCategoriesParseSuccess,
  type CardCategoriesRecord,
  type CardCategoriesWarning,
} from '../list/card-categories-sidecar'
import {
  foldCardCategory,
  formatCardCategories,
  parseCardCategoriesInput,
  parseCardCategory,
  type CardCategory,
} from '../card/card-categories'
import { diffCardCategories } from '../changes/diff-categories'
import { appendChangelog } from '../changes/changelog-writer'
import { listCardNameSet } from '../list/card-names'
import { loadDefaultCategories } from '../config/ritual-config'
import {
  createRenameCategoryChange,
  createSetCategoryOrderChange,
  type CategoryChange,
} from '../changes/change-event'
import {
  addDryRunOption,
  addListTypeFlags,
  addScriptingOptions,
  type DryRunOptions,
} from '../cli/options'
import { runListTargetAction, type ListTarget } from './card-target'
import { fail } from '../cli/action'
import { emitCardResult, emitOutput, emitWarnings, type ScriptingOptions } from '../cli/output'
import type { ListTypeFlags } from '../list/resolve-list'
import type { ListType } from '../list/list-type'
import { ExitCode, localizedCommandError } from '../util/errors'
import { t } from '../i18n/t'

/**
 * `ritual categories` — inspect and edit a list's card categories, the third
 * kind of thing Ritual records about a card (after the line's label and its
 * tags). A category belongs to a card **name** in **one list**: it covers every
 * line of that name whatever its printing or section, it never follows a move,
 * and it lives in the `<list>.categories.json` sidecar rather than on the line.
 *
 * The three mutating subcommands edit the vocabulary, not the card lines, so
 * none of them prunes: a sidecar entry naming a card the list no longer holds
 * survives until the list's own save, a move that rewrites it, or
 * `ritual cleanup`. `list` reports those stale entries and writes nothing —
 * a read must never write.
 *
 * The command writes no card lines and consumes no `&N`, so it stays out of
 * `COMMANDS_WITH_ID_BACKFILL`.
 */

type CategoriesOptions = ListTypeFlags & Partial<ScriptingOptions>
type CategoriesWriteOptions = CategoriesOptions & DryRunOptions

/** One card's categories in a `categories list` payload, primary first. */
export type CategoryCardEntry = {
  name: string
  categories: string[]
}

/** JSON payload of `categories list`. */
export type CategoriesListResult = {
  type: ListType
  list: string
  /**
   * The categories this list already uses — its declared `order` plus any
   * category only a card carries — in display order, with the configured
   * `defaultCategories` deciding the order of the ones the list never declared.
   * An unused configured default is a *suggestion* (edit mode offers those) and
   * is deliberately not listed here: this is what the list records.
   */
  order: string[]
  /** Every categorized card, in the sidecar's canonical name order. */
  cards: CategoryCardEntry[]
  /**
   * Sidecar warnings as rendered prose — today only stale names: entries for
   * cards the list no longer holds. Reported, never pruned.
   */
  warnings: string[]
}

/** What a mutating subcommand did. */
type CategoriesAction = 'rename' | 'order' | 'remove'

/** JSON payload of a `categories rename` / `order` / `remove` run. */
export type CategoriesWriteResult = {
  type: ListType
  list: string
  /** What the run did — the subcommand's own name. */
  action: CategoriesAction
  /** The vocabulary after the edit, in display order. */
  order: string[]
  /**
   * Stored names of the cards whose category lists the edit changed, in the
   * sidecar's canonical name order. Computed from the record diff, so a rename —
   * which emits one list-level event but rewrites every card carrying the name —
   * reports the cards it touched.
   */
  cardsChanged: string[]
  /**
   * Whether the edit changes the sidecar on disk. True on a dry run that would
   * write, false when the edit is a no-op; on a real run it is what the commit
   * actually did. One answer for preview and write, so the two cannot disagree.
   */
  wouldWrite: boolean
  /**
   * Absolute paths written: the sidecar, its `.sha256`, and the changelog.
   * Empty on a dry run — and empty on a real run whose edit changed nothing,
   * which records no changelog entry either.
   */
  writtenFiles: string[]
}

/**
 * Read the target's categories sidecar, refusing when it cannot be parsed —
 * for a write, overwriting a file this cannot read would destroy assignments
 * the user still has on disk; for a read, there is nothing trustworthy to
 * report.
 */
async function loadTargetCategories(
  target: ListTarget,
  knownCardNames?: ReadonlySet<string>,
): Promise<CardCategoriesParseSuccess> {
  const loaded = await loadCardCategories(target.filePath, { knownCardNames })
  if (!loaded.ok) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.categories.sidecarUnreadable',
      { reason: loaded.message },
    )
  }
  return loaded
}

/** Sidecar warnings as prose. A `switch` so a new warning kind is a compile error. */
function renderCategoryWarnings(warnings: readonly CardCategoriesWarning[]): string[] {
  return warnings.map((warning) => {
    switch (warning.kind) {
      case 'unknown-card-names':
        return t('cli.categories.staleNames', { names: warning.names.join(', ') })
    }
  })
}

/** A category name given as a command argument, or a usage refusal. */
function parseCategoryArgument(value: string): CardCategory {
  const parsed = parseCardCategory(value)
  if (!parsed.ok) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.categories.nameInvalid', {
      reason: parsed.message,
    })
  }
  return parsed.category
}

/**
 * Whether `category` is one the record uses — in its vocabulary or on a card.
 * {@link resolveCategoryOrder} already answers exactly that question (the
 * declared order plus every category a card carries), so this reads it rather
 * than walking the record a second way.
 */
function recordUsesCategory(record: CardCategoriesRecord, category: CardCategory): boolean {
  const key = foldCardCategory(category)
  return resolveCategoryOrder(record).some((name) => foldCardCategory(name) === key)
}

/**
 * The write tail every mutating subcommand shares: replay the events onto the
 * record, report the cards the edit rewrote, and either preview or commit.
 *
 * `commitCategoryChanges` writes only the sidecar, so the changelog append is
 * this command's own — exactly as `applyTargetedChanges` owns it for the
 * one-shot card commands.
 */
async function writeCategoryEdit(
  target: ListTarget,
  record: CardCategoriesRecord,
  events: readonly CategoryChange[],
  dryRun: boolean,
  action: CategoriesAction,
): Promise<CategoriesWriteResult> {
  const defaultCategories = await loadDefaultCategories()
  const next = applyCategoryChangesToRecord(record, events)
  const order = resolveCategoryOrder(next, defaultCategories)
  const cardsChanged = diffCardCategories(record, next)
    .filter((event) => event.action === 'set-categories')
    .map((event) => event.cardName)

  if (dryRun) {
    const preview = await previewCategoriesSaveAction(target.filePath, next, defaultCategories)
    return {
      type: target.type,
      list: target.list,
      action,
      order,
      cardsChanged,
      wouldWrite: categoriesSaveTouchesDisk(preview),
      writtenFiles: [],
    }
  }

  // No `knownCardNames`: this command edits the vocabulary, not the card lines,
  // so it never prunes. A stale entry survives until the list's own save, a move
  // that rewrites it, or `ritual cleanup`.
  const committed = await commitCategoryChanges(target.filePath, events, { defaultCategories })
  if (committed.error !== undefined) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.categories.sidecarUnreadable',
      { reason: committed.error },
    )
  }
  const wouldWrite = committed.action !== undefined && categoriesSaveTouchesDisk(committed.action)
  // An edit that changed nothing records nothing: `rename Draw Draw` (or an
  // order equal to the one on disk) leaves the sidecar alone, so appending
  // `Renamed category "Draw" to "Draw"` to the changelog would claim a change
  // the run did not make — and would make the real run disagree with its own
  // `--dry-run`, which `wouldWrite` exists to rule out.
  if (!wouldWrite && cardsChanged.length === 0) {
    return {
      type: target.type,
      list: target.list,
      action,
      order,
      cardsChanged,
      wouldWrite,
      writtenFiles: [...committed.writtenFiles],
    }
  }
  const changelogPath = await appendChangelog(target.filePath, target.list, events)
  return {
    type: target.type,
    list: target.list,
    action,
    order,
    cardsChanged,
    wouldWrite,
    writtenFiles: [...committed.writtenFiles, changelogPath],
  }
}

export function registerCategoriesCommand(program: Command): void {
  const categories = program.command('categories').description(t('help.categories.description'))
  registerCategoriesListSubcommand(categories)
  registerCategoriesRenameSubcommand(categories)
  registerCategoriesOrderSubcommand(categories)
  registerCategoriesRemoveSubcommand(categories)
}

function registerCategoriesListSubcommand(categories: Command): void {
  addScriptingOptions(
    addListTypeFlags(
      categories
        .command('list')
        .description(t('help.categories.list'))
        .argument('[listName]', t('help.listArg.crossType')),
    ),
  ).action(async (listName: string | undefined, options: CategoriesOptions) => {
    await runListTargetAction(listName, options, async (target, scripting) => {
      // The list's own card names, passed purely so the parser can raise its
      // stale-name warning. Nothing is written: a read does not prune.
      //
      // They are passed only when the list parsed losslessly. A partial parse
      // would leave a card the list still holds out of the set, and the warning
      // would then call a perfectly live entry stale — the same reason
      // `ritual cleanup` refuses to prune a file it could not fully read.
      const read = await listCardNameSet(target.type, target.filePath)
      const loaded = await loadTargetCategories(target, read.complete ? read.names : undefined)
      const entries = orderedCategoryEntries(loaded.categories)
      const order = resolveCategoryOrder(loaded.categories, await loadDefaultCategories())
      const result: CategoriesListResult = {
        type: target.type,
        list: target.list,
        order,
        cards: entries.map((entry) => ({ name: entry.name, categories: [...entry.categories] })),
        warnings: read.complete
          ? renderCategoryWarnings(loaded.warnings)
          : [t('cli.categories.staleNotChecked')],
      }

      if (scripting.output === 'text') {
        // The listing is the command's entire point, so it prints even under
        // `--quiet` — the `metadata get` rule: --quiet suppresses chatter,
        // never data.
        if (order.length === 0 && entries.length === 0) {
          emitOutput(t('cli.categories.none', { list: target.list }), scripting)
        } else {
          for (const [index, category] of order.entries()) {
            const key = foldCardCategory(category)
            const count = entries.filter((entry) =>
              entry.categories.some((name) => foldCardCategory(name) === key),
            ).length
            emitOutput(
              t('cli.categories.vocabularyLine', { index: index + 1, category, count }),
              scripting,
            )
          }
          for (const entry of entries) {
            emitOutput(
              t('cli.categories.cardLine', {
                name: entry.name,
                categories: formatCardCategories(entry.categories),
              }),
              scripting,
            )
          }
        }
      } else {
        emitOutput(result, scripting)
      }
      // A stale entry is data the next save will drop, so `--quiet` does not
      // hide it.
      emitWarnings(result.warnings, scripting, { essential: true })
    })
  })
}

function registerCategoriesRenameSubcommand(categories: Command): void {
  const command = addScriptingOptions(
    addListTypeFlags(
      categories
        .command('rename')
        .description(t('help.categories.rename'))
        .argument('[listName]', t('help.listArg.crossType'))
        .argument('<from>', t('help.categories.renameFrom'))
        .argument('<to>', t('help.categories.renameTo')),
    ),
  )
  addDryRunOption(command, t('help.categories.dryRun'))
  command.action(
    async (
      listName: string | undefined,
      fromArg: string,
      toArg: string,
      options: CategoriesWriteOptions,
    ) => {
      await runListTargetAction(listName, options, async (target, scripting) => {
        const from = parseCategoryArgument(fromArg)
        const to = parseCategoryArgument(toArg)
        const loaded = await loadTargetCategories(target)
        if (!recordUsesCategory(loaded.categories, from)) {
          fail(scripting, 'not_found', 'cli.categories.unknown', {
            category: from,
            list: target.list,
          })
          return
        }
        const dryRun = options.dryRun ?? false
        const result = await writeCategoryEdit(
          target,
          loaded.categories,
          [createRenameCategoryChange(from, to)],
          dryRun,
          'rename',
        )
        emitCardResult(
          result,
          t('cli.categories.renamed', {
            mode: dryRun ? 'preview' : 'done',
            from,
            to,
            list: target.list,
          }),
          scripting,
          dryRun,
        )
      })
    },
  )
}

function registerCategoriesOrderSubcommand(categories: Command): void {
  const command = addScriptingOptions(
    addListTypeFlags(
      categories
        .command('order')
        .description(t('help.categories.order'))
        .argument('[listName]', t('help.listArg.crossType'))
        .argument('<value>', t('help.categories.orderValue')),
    ),
  )
  addDryRunOption(command, t('help.categories.dryRun'))
  command.action(
    async (listName: string | undefined, value: string, options: CategoriesWriteOptions) => {
      await runListTargetAction(listName, options, async (target, scripting) => {
        const parsed = parseCardCategoriesInput(value)
        if (!parsed.ok) {
          throw localizedCommandError(
            'usage_error',
            ExitCode.UsageError,
            'cli.categories.nameInvalid',
            { reason: parsed.message },
          )
        }
        if (parsed.categories.length === 0) {
          throw localizedCommandError(
            'usage_error',
            ExitCode.UsageError,
            'cli.categories.orderEmpty',
          )
        }
        const loaded = await loadTargetCategories(target)
        const dryRun = options.dryRun ?? false
        const result = await writeCategoryEdit(
          target,
          loaded.categories,
          [createSetCategoryOrderChange(parsed.categories)],
          dryRun,
          'order',
        )
        emitCardResult(
          result,
          t('cli.categories.reordered', {
            mode: dryRun ? 'preview' : 'done',
            list: target.list,
            order: formatCardCategories(result.order),
          }),
          scripting,
          dryRun,
        )
      })
    },
  )
}

function registerCategoriesRemoveSubcommand(categories: Command): void {
  const command = addScriptingOptions(
    addListTypeFlags(
      categories
        .command('remove')
        .description(t('help.categories.remove'))
        .argument('[listName]', t('help.listArg.crossType'))
        .argument('<name>', t('help.categories.removeName')),
    ),
  )
  addDryRunOption(command, t('help.categories.dryRun'))
  command.action(
    async (listName: string | undefined, nameArg: string, options: CategoriesWriteOptions) => {
      await runListTargetAction(listName, options, async (target, scripting) => {
        const category = parseCategoryArgument(nameArg)
        const loaded = await loadTargetCategories(target)
        if (!recordUsesCategory(loaded.categories, category)) {
          fail(scripting, 'not_found', 'cli.categories.unknown', {
            category,
            list: target.list,
          })
          return
        }
        // Design §5: removing a category has no action of its own — it is the
        // affected cards' `set-categories` plus a `set-category-order` without
        // the name. The engine's own diff computes exactly that.
        const events = diffCardCategories(
          loaded.categories,
          removeCategoryFromRecord(loaded.categories, category),
        )
        const dryRun = options.dryRun ?? false
        const result = await writeCategoryEdit(target, loaded.categories, events, dryRun, 'remove')
        const params = { category, list: target.list, count: result.cardsChanged.length }
        emitCardResult(
          result,
          dryRun
            ? t('cli.categories.removedPreview', params)
            : t('cli.categories.removedDone', params),
          scripting,
          dryRun,
        )
      })
    },
  )
}
