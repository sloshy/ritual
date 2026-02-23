import { describe, expect, test } from 'bun:test'
import { getBundledSiteAssets } from '../../../src/site/bundled-assets'

describe('getBundledSiteAssets', () => {
  test('returns bundled app icon and compiled styles', () => {
    const assets = getBundledSiteAssets()

    expect(assets.appSvg.trimStart().startsWith('<svg')).toBeTrue()
    expect(assets.stylesSourceCss).toContain('.bg-gray-900')
    expect(assets.stylesSourceCss).not.toContain("@import 'tailwindcss';")
  })

  test('transpiles browser script assets from bundled TypeScript sources', () => {
    const assets = getBundledSiteAssets()

    expect(Object.keys(assets.scripts).sort()).toEqual([
      'copy-button.js',
      'deck-sort.js',
      'tooltip.js',
    ])
    expect(assets.scripts['deck-sort.js']).toContain('document.addEventListener')
    expect(assets.scripts['deck-sort.js']).not.toContain('interface CardData')
    expect(assets.scripts['copy-button.js']).toContain('navigator.clipboard.writeText')
    expect(assets.scripts['tooltip.js']).toContain('data-preview-src')
  })
})
