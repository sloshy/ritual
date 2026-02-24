import { describe, expect, test } from 'bun:test'
import { getBundledSiteAssets } from '../../../src/site/bundled-assets'

describe('getBundledSiteAssets', () => {
  test('returns bundled app icon and compiled styles', () => {
    const assets = getBundledSiteAssets()

    expect(assets.appSvg.trimStart().startsWith('<svg')).toBeTrue()
    expect(assets.stylesSourceCss).toContain('.bg-gray-900')
    expect(assets.stylesSourceCss).not.toContain("@import 'tailwindcss';")
  })
})
