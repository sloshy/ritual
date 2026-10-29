/**
 * Screenshots of the demo site for the docs homepage and the README.
 *
 * Copies the committed `demo/` workspace into a temporary directory (its card
 * cache linked, not copied), builds the site there, serves it on loopback, and
 * captures a few pages in the site's dark (`default`) and light
 * (`default-inverted`) themes. Building from a copy matters: `build-site` runs
 * the card-ID backfill, which may write into the workspace it builds.
 *
 * Each capture is re-encoded as WebP by the browser itself (a canvas
 * `toDataURL`), so the script needs nothing beyond Playwright, which the e2e
 * suite already installs.
 *
 *   bun run scripts/docs-screenshots.ts [--refresh <mode>]
 *
 * `--refresh` is passed to `build-site` (default `never`: the demo's card cache
 * in `demo/cache/` must already exist; `auto` downloads it into `demo/cache/`).
 * The images land in `docs-site/src/assets/screenshots/`.
 */
import { chromium, type Page } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { serveStaticSite } from '../src/serve/static'
import type { ThemeName } from '../src/theme/themes'

const ROOT = path.resolve(import.meta.dir, '..')
const DEMO_DIR = path.join(ROOT, 'demo')
const OUT_DIR = path.join(ROOT, 'docs-site/src/assets/screenshots')
const WEBP_QUALITY = 0.8
/** The site's theme key in localStorage (`LS_THEME` in `src/site/useTheme.tsx`). */
const THEME_STORAGE_KEY = 'ritual:theme'

type Theme = 'dark' | 'light'
type Viewport = { width: number; height: number }
type Shot = {
  name: string
  hash: string
  viewport: Viewport
  themes: readonly [Theme, ...Theme[]]
  /** Steps after the page loads (open a modal), before the capture. */
  prepare?: (page: Page) => Promise<void>
}

const DESKTOP: Viewport = { width: 1280, height: 800 }
const PHONE: Viewport = { width: 390, height: 844 }
const SITE_THEME = {
  dark: 'default',
  light: 'default-inverted',
} as const satisfies Record<Theme, ThemeName>

const SHOTS: readonly Shot[] = [
  { name: 'home', hash: '', viewport: DESKTOP, themes: ['dark', 'light'] },
  {
    name: 'deck',
    hash: '#/deck/krenko-s-goblin-horde',
    viewport: DESKTOP,
    themes: ['dark', 'light'],
  },
  {
    name: 'card',
    hash: '#/deck/talrand-spellslinger',
    viewport: DESKTOP,
    themes: ['dark', 'light'],
    prepare: async (page) => {
      await page.locator('.card-item').nth(3).click()
      await page.locator('.modal-close').waitFor()
    },
  },
  {
    name: 'collection',
    hash: '#/collection/trade-binder',
    viewport: DESKTOP,
    themes: ['dark', 'light'],
  },
  { name: 'phone-deck', hash: '#/deck/pauper-elves', viewport: PHONE, themes: ['dark'] },
]

/** Copy `demo/` into `workspace`, linking the card cache rather than copying it. */
function copyDemo(workspace: string): void {
  cpSync(DEMO_DIR, workspace, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(DEMO_DIR, source)
      return relative !== 'cache' && relative !== 'dist'
    },
  })
  mkdirSync(path.join(DEMO_DIR, 'cache'), { recursive: true })
  symlinkSync(path.join(DEMO_DIR, 'cache'), path.join(workspace, 'cache'), 'dir')
}

function buildSite(workspace: string, outDir: string, refresh: string): void {
  const result = Bun.spawnSync(
    [
      'bun',
      'run',
      'index.ts',
      '--base-dir',
      workspace,
      '--no-input',
      'build-site',
      '--refresh',
      refresh,
      '--out-dir',
      outDir,
    ],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
  )
  if (result.exitCode !== 0) throw new Error(`build-site exited with ${result.exitCode}`)
}

/** Wait until the visible images are decoded and the finite animations are done. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    const visible = [...document.images].filter((image) => {
      const box = image.getBoundingClientRect()
      return box.bottom > 0 && box.top < innerHeight && box.width > 0
    })
    await Promise.all(visible.map((image) => image.decode().catch(() => undefined)))
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
  })
  // One more frame pair so the decoded images are painted.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}

/** Re-encode a PNG screenshot as WebP in the browser, returning the bytes. */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ([src, quality]) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no 2d canvas context')
      context.drawImage(image, 0, 0)
      return canvas.toDataURL('image/webp', quality)
    },
    [`data:image/png;base64,${png.toString('base64')}`, WEBP_QUALITY] as const,
  )
  const prefix = 'data:image/webp;base64,'
  if (!dataUrl.startsWith(prefix)) throw new Error('the browser did not encode WebP')
  return Buffer.from(dataUrl.slice(prefix.length), 'base64')
}

const { values } = parseArgs({
  options: { refresh: { type: 'string', default: 'never' } },
  strict: true,
})

const tempRoot = mkdtempSync(path.join(tmpdir(), 'ritual-screenshots-'))
try {
  const workspace = path.join(tempRoot, 'demo')
  // A child of the temp root, so build-site's sibling scratch directories land
  // inside it too and are removed with it.
  const siteDir = path.join(tempRoot, 'site')
  copyDemo(workspace)
  buildSite(workspace, siteDir, values.refresh)
  mkdirSync(OUT_DIR, { recursive: true })

  const server = serveStaticSite({ distDir: siteDir, port: 0, hostname: '127.0.0.1' })
  try {
    await using browser = await chromium.launch()
    for (const shot of SHOTS) {
      for (const theme of shot.themes) {
        await using context = await browser.newContext({
          viewport: shot.viewport,
          colorScheme: theme,
        })
        await context.addInitScript(
          ([key, value]) => {
            localStorage.setItem(key, value)
          },
          [THEME_STORAGE_KEY, SITE_THEME[theme]] as const,
        )
        const page = await context.newPage()
        await page.goto(`${server.url.href}${shot.hash}`)
        // The app renders after fetching its data; Scryfall card art marks that.
        await page.locator('img[src*="scryfall"]').first().waitFor()
        await settle(page)
        if (shot.prepare) {
          await shot.prepare(page)
          await settle(page)
        }
        const webp = await toWebp(page, await page.screenshot())
        const file = path.join(OUT_DIR, `${shot.name}-${theme}.webp`)
        await Bun.write(file, webp)
        console.log(`${path.relative(ROOT, file)} (${Math.round(webp.length / 1024)} KB)`)
      }
    }
  } finally {
    await server.stop(true)
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
