// Keeps the browser-tab favicon in sync with the active theme's flame color.
//
// The static `app.svg` favicon ships with the default (violet) palette; once
// the SPA mounts, this re-tints it to whatever the current theme resolves the
// `--flame-*` vars to, and re-runs whenever the base theme or the in-editor
// custom overrides change. Read-time fallbacks to `defaultFlameStops` guard
// against a theme that omits a var.

import { createEffect } from 'solid-js'
import {
  buildFlameDataUri,
  defaultFlameStops,
  flameStopVars,
  type FlameStops,
} from '../theme/flame'
import type { ThemeStore } from './useTheme'

function resolveFlameStops(): FlameStops {
  const computed = getComputedStyle(document.documentElement)
  const read = (key: keyof FlameStops): string =>
    computed.getPropertyValue(flameStopVars[key]).trim() || defaultFlameStops[key]
  return {
    outer1: read('outer1'),
    outer2: read('outer2'),
    outer3: read('outer3'),
    inner1: read('inner1'),
    inner2: read('inner2'),
    inner3: read('inner3'),
  }
}

// Wires up a reactive effect (must be called within a Solid owner) that paints
// the `<link rel="icon">` with the current theme's flame.
export function syncFaviconToTheme(store: ThemeStore): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) return
  createEffect(() => {
    // Track both signals so the favicon re-tints on theme switch and on any
    // live edit in the theme editor. This relies on useTheme's setters
    // applying the DOM (the data-theme attribute and inline `--*` overrides)
    // *synchronously, before* writing the signal — so by the time this effect
    // body runs, getComputedStyle already reflects the new flame colors.
    store.theme()
    store.customVars()
    link.href = buildFlameDataUri(resolveFlameStops())
  })
}
