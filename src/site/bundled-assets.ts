import * as appSvgTextModule from '../../app.svg' with { type: 'text' }
import * as stylesCssTextModule from './styles.compiled.css' with { type: 'text' }
import * as cardModalScriptTextModule from './scripts/card-modal.ts' with { type: 'text' }
import * as deckSortScriptTextModule from './scripts/deck-sort.ts' with { type: 'text' }
import * as copyButtonScriptTextModule from './scripts/copy-button.ts' with { type: 'text' }

type SiteScriptOutputName = 'card-modal.js' | 'deck-sort.js' | 'copy-button.js'

type BundledSiteScripts = Record<SiteScriptOutputName, string>

type BundledSiteAssets = {
  appSvg: string
  stylesSourceCss: string
  scripts: BundledSiteScripts
}

const siteScriptTranspiler = new Bun.Transpiler({ loader: 'ts' })

function readTextModule(moduleValue: unknown, moduleName: string): string {
  const maybeDefaultExport = (moduleValue as { default?: unknown }).default
  if (typeof maybeDefaultExport !== 'string') {
    throw new Error(`Expected text module for ${moduleName}`)
  }
  return maybeDefaultExport
}

function transpileSiteScript(source: string): string {
  return siteScriptTranspiler.transformSync(source)
}

export function getBundledSiteAssets(): BundledSiteAssets {
  const appSvg = readTextModule(appSvgTextModule, 'app.svg')
  const stylesCssSource = readTextModule(stylesCssTextModule, 'styles.css')
  const cardModalScriptSource = readTextModule(cardModalScriptTextModule, 'card-modal.ts')
  const deckSortScriptSource = readTextModule(deckSortScriptTextModule, 'deck-sort.ts')
  const copyButtonScriptSource = readTextModule(copyButtonScriptTextModule, 'copy-button.ts')

  return {
    appSvg,
    stylesSourceCss: stylesCssSource,
    scripts: {
      'card-modal.js': transpileSiteScript(cardModalScriptSource),
      'deck-sort.js': transpileSiteScript(deckSortScriptSource),
      'copy-button.js': transpileSiteScript(copyButtonScriptSource),
    },
  }
}
