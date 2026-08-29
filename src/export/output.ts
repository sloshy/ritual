import type { CardPrintingsLookup } from '../card/card-printing'
import type { ExportEntry } from './entries'
import {
  renderCsvExport,
  renderJsonExport,
  renderMarkdownExport,
  renderTextExport,
  type RenderedText,
} from './render'
import { columnsNeedScryfallIds, resolveExportScryfallIds } from './scryfall-id'
import { exportFormatUsesColumns, type ExportPreset, type ResolvedExportSettings } from './presets'
import { loadRitualConfig, saveRitualConfig } from '../config/ritual-config'

/**
 * Shared output helpers for the `export` command, its interactive wizard, and
 * the admin route (kept out of the command module so the wizard never imports
 * it back).
 */

/**
 * A rendered export plus anything the caller should tell the user about it —
 * the same shape one renderer returns, since this is that shape at a later
 * stage (a `text` dialect's omitted-extras notice, plus any warning the
 * Scryfall-id resolution added). Aliased rather than redeclared so the two
 * cannot drift into structural twins that only agree by luck.
 */
export type RenderedExport = RenderedText

export type RenderExportOptions = {
  /**
   * Resolves a card's printings for the `scryfallId` column. Callers pass the
   * Scryfall cache (`getCardPrintings`); this module sits below `src/scryfall`
   * and does not reach it itself.
   */
  lookupPrintings: CardPrintingsLookup
}

/**
 * Render the assembled entries to their final string in the resolved format.
 *
 * Async because one column — `scryfallId` — is not in the list files and has to
 * be resolved against the local Scryfall cache. That resolution happens here,
 * the one place every surface renders through, so no caller can forget it; the
 * cache is consulted only when the selected columns need an id AND the format
 * actually reads columns (text/md lines are fixed).
 */
export async function renderExport(
  entries: ExportEntry[],
  settings: ResolvedExportSettings,
  options: RenderExportOptions,
): Promise<RenderedExport> {
  let rendered = entries
  const warnings: string[] = []
  if (exportFormatUsesColumns(settings.format) && columnsNeedScryfallIds(settings.columns)) {
    const resolution = await resolveExportScryfallIds(entries, options.lookupPrintings)
    rendered = resolution.entries
    warnings.push(...resolution.warnings)
  }
  const content = renderContent(rendered, settings)
  warnings.push(...content.warnings)
  return { content: content.content, warnings }
}

/**
 * The payload for one format. Only `text` has anything to warn about — an
 * `arena`/`moxfield` decklist has no board for maybeboard or token cards, so it
 * drops them and says so.
 */
function renderContent(entries: ExportEntry[], settings: ResolvedExportSettings): RenderedText {
  switch (settings.format) {
    case 'json':
      return {
        content: renderJsonExport(entries, settings.columns, settings.dialect),
        warnings: [],
      }
    case 'text':
      return renderTextExport(entries, settings.dialect)
    case 'md':
      return { content: renderMarkdownExport(entries), warnings: [] }
    case 'csv':
      return {
        content: renderCsvExport(entries, settings.columns, {
          header: settings.header,
          quoteAll: settings.quoteAll,
          dialect: settings.dialect,
        }),
        warnings: [],
      }
  }
}

/** Persist the resolved output shape as a named preset in ritual.config.json. */
export async function saveExportPreset(
  name: string,
  settings: ResolvedExportSettings,
): Promise<void> {
  const config = await loadRitualConfig()
  const preset: ExportPreset = {
    format: settings.format,
    columns: settings.columns,
    header: settings.header,
    quoteAll: settings.quoteAll,
  }
  // Stored only when it says something: a `ritual` dialect is the default, and
  // writing it into every saved preset would be noise in the config file.
  if (settings.dialect !== 'ritual') preset.dialect = settings.dialect
  config.exportPresets = { ...config.exportPresets, [name]: preset }
  await saveRitualConfig(config)
}
