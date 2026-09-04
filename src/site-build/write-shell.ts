/**
 * The last phase of a site build: `index.json`, the SPA bundle and icon, the
 * dictionaries, the boot script and shell, and the themed stylesheet.
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { t } from '../i18n/t'
import {
  getDefaultCategories,
  getDefaultLanguage,
  getPriceSources,
  getSearchDebounceMs,
  getSiteSellMode,
} from '../config/ritual-config'
import type { SiteIndex } from '../list/site-data'
import type { RitualConfig } from '../config/ritual-config'
import { generateAllThemesCss, generateCustomThemeCss, type CustomTheme } from '../theme/themes'
import { appBootScript, BOOT_SCRIPT_FILE, renderAppShell } from './html-shell'
import type { LocaleBuildPlan } from './locales'
import type { SiteSpaAssets } from './assets'

/**
 * What differs between the `index.json` a build bakes and the one `serve --api`
 * answers live; every other field is read from config. Each is documented on
 * {@link SiteIndex}.
 */
export type SiteIndexParts = Omit<
  SiteIndex,
  | 'wantedLists'
  | 'searchDebounceMs'
  | 'defaultLanguage'
  | 'sellMode'
  | 'priceSources'
  | 'defaultCategories'
> & { wantedLists: NonNullable<SiteIndex['wantedLists']> }

/** Assemble `index.json` from its parts and the (given or current) config. */
export function buildSiteIndex(parts: SiteIndexParts, config?: RitualConfig): SiteIndex {
  return {
    ...parts,
    wantedLists: parts.wantedLists.length > 0 ? parts.wantedLists : undefined,
    searchDebounceMs: getSearchDebounceMs(config),
    defaultLanguage: getDefaultLanguage(config),
    sellMode: getSiteSellMode(config),
    priceSources: getPriceSources(config),
    defaultCategories: getDefaultCategories(config),
  }
}

/** Write `index.json`. */
export async function writeSiteIndex(buildDir: string, parts: SiteIndexParts): Promise<void> {
  await Bun.write(path.join(buildDir, 'index.json'), JSON.stringify(buildSiteIndex(parts)))
}

/** What the shell is rendered from. */
export type SiteShellInput = {
  buildDir: string
  spa: SiteSpaAssets
  localePlan: LocaleBuildPlan
  /** Either a built-in `ThemeName` or a custom name from `--theme-file`; validated by the caller. */
  initialThemeName: string
  customThemes: CustomTheme[]
}

/** Write the SPA bundle, the dictionaries, the boot script, `index.html` and `styles.css`. */
export async function writeSiteShell(input: SiteShellInput): Promise<void> {
  const { buildDir, spa, localePlan, initialThemeName, customThemes } = input
  // Write pre-built SPA
  console.log(t('cli.buildSite.writingApp'))
  await Bun.write(path.join(buildDir, 'app.js'), spa.appJs)
  await Bun.write(path.join(buildDir, 'app.svg'), spa.appSvg)

  // Dictionaries as data. English is inline in the bundle and never fetched; it
  // is written anyway so a static host serves a self-describing `availableLocales`.
  const localesDir = path.join(buildDir, 'locales')
  await fs.mkdir(localesDir, { recursive: true })
  for (const entry of localePlan.emitted) {
    await Bun.write(path.join(localesDir, `${entry.tag}.json`), JSON.stringify(entry.catalog))
  }
  console.log(
    t('cli.buildSite.writingLocales', {
      counted: t('domain.count.files', { count: localePlan.emitted.length }),
      locale: localePlan.locale,
    }),
  )

  // Theme *and* locale bootstrap, external so a `script-src 'self'` policy
  // accepts it (the admin's does, and both shells are the same code).
  await Bun.write(path.join(buildDir, BOOT_SCRIPT_FILE), appBootScript)
  await Bun.write(
    path.join(buildDir, 'index.html'),
    renderAppShell({
      lang: localePlan.locale,
      // i18n-exempt: the product name, a proper noun that is the same in every locale
      title: 'Ritual',
      initialTheme: initialThemeName,
      viewport: 'width=device-width, initial-scale=1.0, viewport-fit=cover',
    }),
  )

  // Every built-in theme as a `:root[data-theme=...]` block, so the runtime
  // switches by toggling the html attribute, plus any --theme-file themes.
  console.log(
    customThemes.length > 0
      ? t('cli.buildSite.writingCssCustom', {
          theme: initialThemeName,
          count: customThemes.length,
        })
      : t('cli.buildSite.writingCss', { theme: initialThemeName }),
  )
  const allThemes = generateAllThemesCss()
  const customThemesCss = customThemes.map((theme) => generateCustomThemeCss(theme)).join('\n')
  await Bun.write(
    path.join(buildDir, 'styles.css'),
    `${allThemes}${customThemesCss ? '\n' + customThemesCss : ''}\n${spa.stylesSourceCss}`,
  )
}
