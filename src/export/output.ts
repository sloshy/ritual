import type { ExportEntry } from './entries'
import { renderCsvExport, renderJsonExport } from './render'
import type { ExportPreset, ResolvedExportSettings } from './presets'
import { loadRitualConfig, saveRitualConfig } from '../ritual-config'

/**
 * Shared output helpers for the `export` command and its interactive wizard
 * (kept out of the command module so the wizard never imports it back).
 */

/** Render the assembled entries to their final CSV or JSON string. */
export function renderExport(entries: ExportEntry[], settings: ResolvedExportSettings): string {
  return settings.format === 'json'
    ? renderJsonExport(entries, settings.columns)
    : renderCsvExport(entries, settings.columns, {
        header: settings.header,
        quoteAll: settings.quoteAll,
      })
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
  config.exportPresets = { ...config.exportPresets, [name]: preset }
  await saveRitualConfig(config)
}
