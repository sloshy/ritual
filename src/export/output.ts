import type { CardPrintingsLookup } from '../card-printing'
import { getCardPrintings } from '../scryfall'
import type { ExportEntry } from './entries'
import { renderCsvExport, renderJsonExport, renderMarkdownExport, renderTextExport } from './render'
import { columnsNeedScryfallIds, resolveExportScryfallIds } from './scryfall-id'
import { exportFormatUsesColumns, type ExportPreset, type ResolvedExportSettings } from './presets'
import { loadRitualConfig, saveRitualConfig } from '../ritual-config'

/**
 * Shared output helpers for the `export` command, its interactive wizard, and
 * the admin route (kept out of the command module so the wizard never imports
 * it back).
 */

/** A rendered export plus anything the caller should tell the user about it. */
export type RenderedExport = {
  /** The export payload; no renderer emits a trailing newline (the writer appends one). */
  content: string
  /** Warnings raised while rendering, e.g. a printing with no cached Scryfall id. */
  warnings: string[]
}

export type RenderExportOptions = {
  /** Injectable for tests; the Scryfall cache by default. */
  lookupPrintings?: CardPrintingsLookup
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
  options?: RenderExportOptions,
): Promise<RenderedExport> {
  let rendered = entries
  const warnings: string[] = []
  if (exportFormatUsesColumns(settings.format) && columnsNeedScryfallIds(settings.columns)) {
    const resolution = await resolveExportScryfallIds(
      entries,
      options?.lookupPrintings ?? getCardPrintings,
    )
    rendered = resolution.entries
    warnings.push(...resolution.warnings)
  }
  return { content: renderContent(rendered, settings), warnings }
}

function renderContent(entries: ExportEntry[], settings: ResolvedExportSettings): string {
  switch (settings.format) {
    case 'json':
      return renderJsonExport(entries, settings.columns, settings.dialect)
    case 'text':
      return renderTextExport(entries)
    case 'md':
      return renderMarkdownExport(entries)
    case 'csv':
      return renderCsvExport(entries, settings.columns, {
        header: settings.header,
        quoteAll: settings.quoteAll,
        dialect: settings.dialect,
      })
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
