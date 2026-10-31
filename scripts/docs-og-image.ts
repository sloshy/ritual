#!/usr/bin/env bun
/**
 * Render the docs site's social preview image and Apple touch icon.
 *
 *   bun run scripts/docs-og-image.ts
 *
 * Writes `docs-site/public/og.png` (1200×630, the image link previews show;
 * astro.config.mjs points `og:image` and `twitter:image` at it) and
 * `docs-site/public/apple-touch-icon.png` (180×180). Both are drawn from the
 * app icon (`app.svg`) and the demo's home-page screenshot, in the docs' dark
 * palette, with the Playwright Chromium the end-to-end tests use
 * (`bunx playwright install chromium`). Re-run it after the icon, the
 * tagline, or the home screenshot changes, and commit the two images.
 */
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const publicDir = path.join(root, 'docs-site/public')

const icon = await readFile(path.join(root, 'app.svg'), 'utf8')
const screenshot = await readFile(
  path.join(root, 'docs-site/src/assets/screenshots/home-dark.webp'),
)
const screenshotUrl = `data:image/webp;base64,${screenshot.toString('base64')}`

// The docs' dark palette (docs-site/src/styles/custom.css).
const background = 'oklch(20% 0.024 285)'
const accent = 'oklch(80% 0.13 290)'
const text = 'oklch(95% 0.006 285)'
const muted = 'oklch(75% 0.018 285)'

const ogHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: radial-gradient(circle at 18% 30%, oklch(32% 0.08 290), ${background} 60%);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: ${text};
    position: relative;
  }
  .text { position: absolute; left: 72px; top: 96px; width: 520px; }
  .brand { display: flex; align-items: center; gap: 20px; }
  .brand svg { width: 112px; height: 112px; }
  h1 { font-size: 96px; margin: 0; letter-spacing: -2px; }
  p { font-size: 36px; line-height: 1.3; margin: 40px 0 0; color: ${muted}; }
  p strong { color: ${accent}; font-weight: 600; }
  .shot {
    position: absolute; left: 640px; top: 80px; width: 720px;
    border-radius: 16px; border: 2px solid oklch(45% 0.024 285);
    box-shadow: 0 24px 64px rgb(0 0 0 / 0.5);
  }
</style></head><body>
  <div class="text">
    <div class="brand">${icon}<h1>Ritual</h1></div>
    <p>Your <strong>Magic: The Gathering</strong> decks and collection as plain files. Price them, sync them, and publish your own site.</p>
  </div>
  <img class="shot" src="${screenshotUrl}" alt="">
</body></html>`

const touchIconHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 180px; height: 180px; overflow: hidden; background: ${background}; }
  svg { display: block; width: 180px; height: 180px; }
</style></head><body>${icon}</body></html>`

await using browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(ogHtml, { waitUntil: 'load' })
await page.screenshot({ path: path.join(publicDir, 'og.png') })
await page.setViewportSize({ width: 180, height: 180 })
await page.setContent(touchIconHtml, { waitUntil: 'load' })
await page.screenshot({ path: path.join(publicDir, 'apple-touch-icon.png') })
console.log(`Wrote og.png and apple-touch-icon.png to ${path.relative(root, publicDir)}/`)
