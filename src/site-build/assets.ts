/**
 * What a site ships besides its lists: the SPA bundle (built from source, or
 * pre-built into a compiled binary — see `src/site/bundled-assets`), the mana
 * symbol images, and any `--theme-file` themes its CSS is baked with.
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { downloadSymbol, fetchSymbology } from '../scryfall'
import { t } from '../i18n/t'
import { refreshStaleAllowed, type RefreshMode } from '../cache/refresh'
import { getErrorMessage } from '../util/errors'
import { parseCustomTheme, type CustomTheme } from '../theme/themes'

export type SiteSpaAssets = {
  appSvg: string
  stylesSourceCss: string
  appJs: string
}

export async function buildSiteSpaFromSource(): Promise<SiteSpaAssets> {
  const { SolidPlugin } = await import('@dschz/bun-plugin-solid')
  // A filesystem coupling to the SPA's sources, not an import: neither tsc nor
  // eslint's layering rule sees it, so `src/site` moving means editing this.
  const siteSrcDir = path.join(import.meta.dir, '..', 'site')
  const appSvgPath = path.join(import.meta.dir, '..', '..', 'app.svg')

  const bundle = async (entry: string, ext: '.js' | '.css'): Promise<string> => {
    const result = await Bun.build({
      entrypoints: [path.join(siteSrcDir, entry)],
      target: 'browser',
      ...(ext === '.js'
        ? {
            format: 'esm',
            define: { 'process.env.NODE_ENV': '"development"' },
            plugins: [SolidPlugin()],
          }
        : { minify: false }),
    })
    if (!result.success) {
      for (const log of result.logs) console.error(log)
      throw new Error(`Site SPA ${ext} build failed`)
    }
    const output = result.outputs.find((o) => o.path.endsWith(ext))
    if (!output) throw new Error(`Site SPA build produced no ${ext} output`)
    return output.text()
  }
  return {
    appJs: await bundle('app.tsx', '.js'),
    stylesSourceCss: await bundle('styles.css', '.css'),
    appSvg: await fs.readFile(appSvgPath, 'utf-8'),
  }
}

/** Make sure every `{X}` token in `text` has an image, refreshing the symbology once if not. */
export type EnsureSymbols = (text: string | undefined | null) => Promise<void>

/** The symbols a build has on disk, and the hook that grows the set. */
export type SymbolCollector = {
  /** `{ "{W}": "images/symbols/W.svg" }`, as the site's detail JSON records it. */
  symbolMap: Record<string, string>
  ensureSymbols: EnsureSymbols
}

/**
 * Fetch and download the symbology. `never` means "use the existing cache
 * as-is", so an uncached symbology is left uncached rather than downloaded —
 * the site then renders without mana symbols, which the warning says out loud.
 */
export async function createSymbolCollector(
  mode: RefreshMode,
  symbolsDir: string,
): Promise<SymbolCollector> {
  console.log(t('cli.buildSite.fetchingSymbols'))
  const symbologyNetwork = refreshStaleAllowed(mode)
  let symbols = await fetchSymbology({ network: symbologyNetwork })
  if (symbols.length === 0 && !symbologyNetwork) {
    console.warn(t('cli.buildSite.noSymbology'))
  }
  const symbolMap: Record<string, string> = {}
  const missingSymbols = new Set<string>()

  const updateSymbolMap = async (): Promise<void> => {
    await Promise.all(
      symbols.map(async (s) => {
        if (symbolMap[s.symbol]) return
        try {
          const filename = await downloadSymbol(s, symbolsDir)
          symbolMap[s.symbol] = `images/symbols/${filename}`
        } catch (e) {
          console.error(t('cli.buildSite.symbolDownloadFailed', { symbol: s.symbol }), e)
        }
      }),
    )
  }

  await updateSymbolMap()

  const ensureSymbols: EnsureSymbols = async (text) => {
    if (!text) return
    const matches = text.match(/\{[^{}]+\}/g)
    if (!matches) return

    let needsRefresh = false
    for (const m of matches) {
      if (!symbolMap[m] && !missingSymbols.has(m)) {
        needsRefresh = true
        break
      }
    }

    if (needsRefresh) {
      if (!symbologyNetwork) {
        for (const m of matches) if (!symbolMap[m]) missingSymbols.add(m)
        return
      }
      console.log(t('cli.buildSite.refreshingSymbology'))
      symbols = await fetchSymbology({ force: true })
      await updateSymbolMap()

      // Mark still-missing symbols as missing so we don't retry loop
      for (const m of matches) {
        if (!symbolMap[m]) {
          missingSymbols.add(m)
        }
      }
    }
  }

  return { symbolMap, ensureSymbols }
}

/** Loads every `--theme-file` JSON; returns an error message string on the first failure. */
export async function loadCustomThemes(paths: readonly string[]): Promise<CustomTheme[] | string> {
  const themes: CustomTheme[] = []
  for (const filePath of paths) {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      return t('cli.buildSite.themeFileUnreadable', {
        path: filePath,
        reason: getErrorMessage(err),
      })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      return t('cli.buildSite.themeFileNotJson', {
        path: filePath,
        reason: getErrorMessage(err),
      })
    }
    const result = parseCustomTheme(parsed)
    if (typeof result === 'string') {
      return t('cli.buildSite.themeFileInvalid', { path: filePath, reason: result })
    }
    themes.push(result)
  }
  return themes
}
