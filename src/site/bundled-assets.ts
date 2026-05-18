import * as appSvgTextModule from '../../app.svg' with { type: 'text' }
import * as stylesCssTextModule from './styles.compiled.css' with { type: 'text' }
import * as appJsTextModule from './app.compiled.js' with { type: 'text' }
import { readTextModule } from '../bundled-text'

type BundledSiteAssets = {
  appSvg: string
  stylesSourceCss: string
  appJs: string
}

export function getBundledSiteAssets(): BundledSiteAssets {
  const appSvg = readTextModule(appSvgTextModule, 'app.svg')
  const stylesCssSource = readTextModule(stylesCssTextModule, 'styles.css')
  const appJs = readTextModule(appJsTextModule, 'site/app.js')

  return {
    appSvg,
    stylesSourceCss: stylesCssSource,
    appJs,
  }
}
