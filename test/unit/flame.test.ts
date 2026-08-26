import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildFlameDataUri,
  buildFlameSvg,
  defaultFlameStops,
  flameStopVars,
  flameTransform,
  type FlameStops,
} from '../../src/theme/flame'
import { themeVarMetadata } from '../../src/site/theme-vars-metadata'

const stops: FlameStops = {
  outer1: '#111111',
  outer2: '#222222',
  outer3: '#333333',
  inner1: '#aaaaaa',
  inner2: '#bbbbbb',
  inner3: '#cccccc',
}

describe('buildFlameSvg', () => {
  test('embeds all six stop colors', () => {
    const svg = buildFlameSvg(stops)
    for (const color of Object.values(stops)) {
      expect(svg).toContain(`stop-color="${color}"`)
    }
  })

  test('is a well-formed standalone SVG with both gradients and paths', () => {
    const svg = buildFlameSvg(stops)
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('id="ritual-flame-outer"')
    expect(svg).toContain('id="ritual-flame-inner"')
    expect(svg).toContain('fill="url(#ritual-flame-outer)"')
    expect(svg).toContain('fill="url(#ritual-flame-inner)"')
    // Two <path> elements (outer body + inner core).
    expect(svg.match(/<path /g)).toHaveLength(2)
    // The widen-about-center transform must be applied to the group.
    expect(svg).toContain(`transform="${flameTransform}"`)
  })

  test('different stops produce different output', () => {
    expect(buildFlameSvg(stops)).not.toBe(buildFlameSvg(defaultFlameStops))
  })
})

describe('committed app.svg', () => {
  test('matches buildFlameSvg(defaultFlameStops) byte-for-byte', () => {
    // app.svg is the single static asset (favicon fallback, docs logo, bundled
    // SPA asset). It must stay generated from the flame module so the static
    // icon and the in-app/themed icon never drift. Regenerate with:
    //   bun -e "import {buildFlameSvg,defaultFlameStops} from './src/flame.ts'; \
    //     await Bun.write('app.svg', buildFlameSvg(defaultFlameStops))"
    const committed = readFileSync(path.join(import.meta.dir, '../../app.svg'), 'utf8')
    expect(committed).toBe(buildFlameSvg(defaultFlameStops))
  })
})

describe('buildFlameDataUri', () => {
  test('produces a percent-encoded svg data URI carrying the given stops', () => {
    const uri = buildFlameDataUri(stops)
    expect(uri).toStartWith('data:image/svg+xml,')
    // Proves encoding actually ran (raw '<' would have failed to encode).
    expect(uri).toContain('%3C')
    expect(uri).not.toContain('<')
    // Round-trips back to the SVG for the *same* stops it was given.
    expect(decodeURIComponent(uri.slice('data:image/svg+xml,'.length))).toBe(buildFlameSvg(stops))
  })
})

describe('flameStopVars', () => {
  test('maps every stop to a distinct --flame-* custom property', () => {
    const names = Object.values(flameStopVars)
    expect(names).toHaveLength(6)
    expect(new Set(names).size).toBe(6)
    for (const name of names) expect(name).toMatch(/^--flame-(outer|inner)-[1-3]$/)
    // Keys cover exactly the FlameStops shape.
    expect(Object.keys(flameStopVars).sort()).toEqual([
      'inner1',
      'inner2',
      'inner3',
      'outer1',
      'outer2',
      'outer3',
    ])
  })

  test('every flame var is exposed in the theme editor metadata', () => {
    // The editor only shows vars listed in theme-vars-metadata; a flame stop
    // missing there would be silently uneditable. Guards that registry.
    const documented = new Set(themeVarMetadata.map((m) => m.name))
    for (const name of Object.values(flameStopVars)) {
      expect(documented.has(name), `${name} should have theme-editor metadata`).toBe(true)
    }
  })
})
