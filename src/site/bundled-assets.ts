import * as appSvgTextModule from '../../app.svg' with { type: 'text' }
import * as stylesCssTextModule from './styles.compiled.css' with { type: 'text' }

type BundledSiteAssets = {
  appSvg: string
  stylesSourceCss: string
}

function readTextModule(moduleValue: unknown, moduleName: string): string {
  const maybeDefaultExport = (moduleValue as { default?: unknown }).default
  if (typeof maybeDefaultExport !== 'string') {
    throw new Error(`Expected text module for ${moduleName}`)
  }
  return maybeDefaultExport
}

export function getBundledSiteAssets(): BundledSiteAssets {
  const appSvg = readTextModule(appSvgTextModule, 'app.svg')
  const stylesCssSource = readTextModule(stylesCssTextModule, 'styles.css')

  return {
    appSvg,
    stylesSourceCss: stylesCssSource,
  }
}
