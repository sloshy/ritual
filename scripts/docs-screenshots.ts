/**
 * Screenshots of the demo workspace for the docs site and the README.
 *
 * Copies the committed `demo/` workspace (the files git tracks, so no local
 * state such as `.logins/`) into a temporary directory, builds the public site
 * there, serves it on
 * loopback, and captures pages in the site's dark (`default`) and light
 * (`default-inverted`) themes. Building from a copy matters: `build-site` runs
 * the card-ID backfill, which may write into the workspace it builds.
 *
 * Three targets, each started only when a selected shot needs it:
 *
 * - `site`: the demo exactly as committed, as the live demo shows it.
 * - `stores`: a second copy whose config enables the Cardmarket and Card
 *   Kingdom price stores, built with `--sell-mode`, for the pages about
 *   prices and sell mode. It needs the Card Kingdom feed in `demo/cache/`.
 * - `admin`: `ritual admin` on loopback against a copy of the workspace,
 *   signed in with an account `ritual admin setup` creates in that copy.
 *
 * Each capture is re-encoded as WebP by the browser itself (a canvas
 * `toDataURL`), so the script needs nothing beyond Playwright, which the e2e
 * suite already installs.
 *
 *   bun run scripts/docs-screenshots.ts [--refresh <mode>] [--only <name,…>]
 *
 * `--refresh` is passed to `build-site` and `admin` (default `never`: the
 * demo's card cache in `demo/cache/` must already exist). Under `never` each
 * copy gets its own copy of the cache (a reflink where the filesystem has
 * them), because a run can still write to it: the card cache saves cards it
 * looks up, and Ritual's atomic writes follow symlinks to the real file. So
 * nothing under `demo/` is touched. Any other mode links `demo/cache/` itself,
 * so what it downloads (`auto` fetches the cache and the Card Kingdom feed)
 * lands in `demo/cache/` for the next run.
 * `--only` retakes just the named shots (comma-separated, prefix match on the
 * name, so `--only admin` retakes every admin shot). The images land in
 * `docs-site/src/assets/screenshots/` as `<name>-<theme>.webp`.
 */
import {
  chromium,
  type Browser,
  type Locator,
  type Page,
  type ViewportSize,
} from '@playwright/test'
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { REFRESH_MODES, type RefreshMode } from '../src/cache/refresh'
import { serveStaticSite } from '../src/serve/static'
import type { ThemeName } from '../src/theme/themes'

const ROOT = path.resolve(import.meta.dir, '..')
const DEMO_DIR = path.join(ROOT, 'demo')
const OUT_DIR = path.join(ROOT, 'docs-site/src/assets/screenshots')
const WEBP_QUALITY = 0.8
/** The site's theme key in localStorage (`LS_THEME` in `src/site/useTheme.tsx`). */
const THEME_STORAGE_KEY = 'ritual:theme'
/** Throwaway credentials for the admin account created in the temporary copy. */
const ADMIN_USER = 'docs'
const ADMIN_PASSWORD = 'docs-screenshots-password'
/** Room left around a cropped element, in CSS pixels. */
const CROP_MARGIN = 24

type Theme = 'dark' | 'light'
type Target = 'site' | 'stores' | 'admin'
type Shot = {
  name: string
  target: Target
  hash: '' | `#/${string}`
  viewport: ViewportSize
  themes: readonly [Theme, ...Theme[]]
  /** Emulate a touch phone (coarse pointer, no hover). */
  touch?: boolean
  /** What marks the page as rendered; defaults to a Scryfall card image. */
  ready?: string
  /** Steps after the page loads (open a modal), before the capture. */
  prepare?: (page: Page) => Promise<void>
  /** Crop the capture to this element (plus a margin) instead of the viewport. */
  crop?: string
}

const DESKTOP: ViewportSize = { width: 1280, height: 800 }
const PHONE: ViewportSize = { width: 390, height: 844 }
const BOTH = ['dark', 'light'] as const
const SITE_THEME = {
  dark: 'default',
  light: 'default-inverted',
} as const satisfies Record<Theme, ThemeName>
const CARD_IMAGE = 'img[src*="scryfall"]'
const OPEN_MODAL = 'dialog[open] .modal-panel'

/** Type a name into one Trade column's search and take its first suggestion. */
async function addToTrade(page: Page, side: 'left' | 'right', query: string): Promise<void> {
  const column = page.locator(`.trade-col[data-side="${side}"]`)
  await column.locator('.search-input').fill(query)
  const suggestion = column.locator('.search-suggest-row').first()
  await suggestion.waitFor()
  const rows = column.locator('.trade-row')
  const before = await rows.count()
  await suggestion.click()
  if (side === 'right') {
    // Every right-column pick asks for the printing on offer.
    const picker = page.locator('.trade-picker-modal')
    await picker.locator('.trade-picker-item').first().click()
    await picker.locator('button', { hasText: 'Add to Trade' }).click()
    await picker.waitFor({ state: 'hidden' })
  }
  await rows.nth(before).waitFor()
}

/** Hover a card tile so its edit controls show, and return it. */
async function hoverTile(page: Page, name: string): Promise<Locator> {
  const tile = page.locator(`.card-item[data-name="${name}"]`).first()
  await tile.hover()
  return tile
}

const SHOTS: readonly Shot[] = [
  // The docs homepage and the README.
  { name: 'home', target: 'site', hash: '', viewport: DESKTOP, themes: BOTH },
  {
    name: 'deck',
    target: 'site',
    hash: '#/deck/krenko-s-goblin-horde',
    viewport: DESKTOP,
    themes: BOTH,
  },
  {
    name: 'card',
    target: 'site',
    hash: '#/deck/talrand-spellslinger',
    viewport: DESKTOP,
    themes: BOTH,
    prepare: async (page) => {
      await page.locator('.card-item').nth(3).click()
      await page.locator('.modal-close').waitFor()
    },
  },
  {
    name: 'collection',
    target: 'site',
    hash: '#/collection/trade-binder',
    viewport: DESKTOP,
    themes: BOTH,
  },
  {
    name: 'phone-deck',
    target: 'site',
    hash: '#/deck/pauper-elves',
    viewport: PHONE,
    themes: ['dark'],
  },

  // Public site pages.
  {
    name: 'list-view',
    target: 'site',
    hash: '#/collection/trade-binder?view=list',
    viewport: { width: 1280, height: 720 },
    themes: BOTH,
    ready: '.card-item',
  },
  {
    name: 'changes-modal',
    target: 'site',
    hash: '#/deck/meren-graveyard-value',
    viewport: DESKTOP,
    themes: BOTH,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'View Changes' }).click()
      await page.getByRole('button', { name: /Older/ }).click()
      await page
        .locator(OPEN_MODAL)
        .getByText(/^2 \/ \d+$/)
        .waitFor()
    },
    crop: OPEN_MODAL,
  },
  {
    name: 'filter-menu',
    target: 'site',
    hash: '#/collection/trade-binder',
    viewport: DESKTOP,
    themes: BOTH,
    prepare: async (page) => {
      await page.locator('.filter-menu > button').click()
      await page.locator('.filter-menu-panel').waitFor()
    },
  },
  {
    name: 'combined-view',
    target: 'site',
    hash: '#/combined?lists=deck:talrand-spellslinger,collection:trade-binder,wanted:upgrades-wishlist&size=medium',
    viewport: DESKTOP,
    themes: BOTH,
  },
  {
    name: 'find',
    target: 'site',
    hash: '#/find',
    viewport: { width: 1280, height: 1000 },
    themes: BOTH,
    ready: '.find-input',
    prepare: async (page) => {
      await page
        .locator('.find-input')
        .fill(
          ['Sol Ring', 'Lightning Bolt', 'Llanowar Elves', 'Mana Drain', 'Black Lotus'].join('\n'),
        )
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await page.locator('.find-results .card-item').first().waitFor()
    },
  },
  {
    name: 'find-in-lists',
    target: 'site',
    hash: '#/deck/meren-graveyard-value',
    viewport: DESKTOP,
    themes: BOTH,
    prepare: async (page) => {
      await page.locator('.card-item[data-name="sol ring"] .card-binder').first().click()
      await page.locator('.card-modal').getByRole('button', { name: 'Find in Lists' }).click()
      const modal = page.locator('.find-printings-modal')
      await modal.getByRole('button', { name: 'List', exact: true }).click()
      await modal.locator('.card-item').first().waitFor()
    },
    crop: OPEN_MODAL,
  },
  {
    name: 'prices',
    target: 'stores',
    hash: '#/collection/trade-binder?view=list&prices=cardkingdom',
    viewport: { width: 1280, height: 640 },
    themes: BOTH,
    ready: '.card-item',
  },
  {
    name: 'sell-mode',
    target: 'stores',
    hash: '#/collection/trade-binder?view=list',
    viewport: { width: 1280, height: 720 },
    themes: BOTH,
    ready: '.card-item',
    prepare: async (page) => {
      await page.locator('.toolbar-sell-toggle').click()
      await page.locator('.list-buylist-price').first().waitFor()
    },
  },
  {
    name: 'trade',
    target: 'site',
    hash: '#/trade',
    viewport: DESKTOP,
    themes: BOTH,
    ready: '.trade-col',
    prepare: async (page) => {
      for (const name of ['Ragavan', 'Wrenn and Six', "Urza's Saga"]) {
        await addToTrade(page, 'left', name)
      }
      for (const name of ['Mana Drain', 'Bloodghast']) await addToTrade(page, 'right', name)
    },
  },
  {
    name: 'editing',
    target: 'site',
    hash: '#/deck/pauper-elves?size=medium',
    viewport: DESKTOP,
    themes: BOTH,
    prepare: async (page) => {
      await page.locator('.btn-edit').click()
      await page.locator('.edit-banner').waitFor()
      const added = await hoverTile(page, 'birchlore rangers')
      await added.locator('.edit-btn-increment').click()
      await hoverTile(page, 'elvish visionary')
    },
  },
  {
    name: 'phone-filters',
    target: 'site',
    hash: '#/collection/trade-binder',
    viewport: PHONE,
    themes: BOTH,
    touch: true,
    prepare: async (page) => {
      await page.locator('.filter-menu > button').click()
      await page.locator('.filter-menu-panel').waitFor()
    },
  },
  {
    name: 'phone-select',
    target: 'site',
    hash: '#/deck/pauper-elves',
    viewport: PHONE,
    themes: BOTH,
    touch: true,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Select', exact: true }).click()
      // Two cards side by side, so both ticks are in the capture.
      await page.locator('.card-item').nth(0).click()
      await page.locator('.card-item').nth(1).click()
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    },
  },

  // Admin pages.
  {
    name: 'admin-dashboard',
    target: 'admin',
    hash: '#/',
    viewport: DESKTOP,
    themes: BOTH,
    ready: '.section-heading',
  },
  {
    name: 'admin-editor',
    target: 'admin',
    hash: '#/edit/deck/Pauper%20Elves',
    viewport: { width: 1280, height: 1000 },
    themes: BOTH,
    prepare: async (page) => {
      const added = await hoverTile(page, 'birchlore rangers')
      await added.locator('.edit-btn-increment').click()
      await hoverTile(page, 'elvish visionary')
    },
  },
  {
    name: 'admin-history',
    target: 'admin',
    hash: '#/history',
    viewport: { width: 1280, height: 664 },
    themes: BOTH,
    ready: '#history-list-select',
    prepare: async (page) => {
      await page.locator('#history-list-select').selectOption('deck:Meren Graveyard Value')
      await page.locator('.history-set-main').first().click()
      await page.locator('.history-set-lines').first().waitFor()
    },
  },
  {
    name: 'admin-lists',
    target: 'admin',
    hash: '#/lists',
    viewport: { width: 1280, height: 664 },
    themes: BOTH,
    ready: '.section-heading',
  },
  {
    name: 'admin-move',
    target: 'admin',
    hash: '#/move',
    viewport: { width: 1280, height: 664 },
    themes: BOTH,
    ready: '.section-heading',
    prepare: async (page) => {
      await page.getByPlaceholder(/search every list/).fill('sol ring')
      await page.locator('.move-search-row').first().click()
      // Leave the pointer on the menu, so the row's card preview is hidden.
      await page.locator('.move-destination-menu .card-context-menu-item').last().hover()
    },
  },
  {
    name: 'admin-import',
    target: 'admin',
    hash: '#/import/deck',
    viewport: { width: 1280, height: 680 },
    themes: BOTH,
    ready: '.section-heading',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Paste Text' }).click()
      const main = page.locator('main')
      await main
        .locator('textarea')
        .fill(
          [
            '## Commander',
            '1 Krenko, Mob Boss',
            '',
            '## Main',
            '1 Goblin Bombardment',
            '1 Impact Tremors',
            '36 Mountain',
          ].join('\n'),
        )
      await main.getByPlaceholder('Imported Deck').fill('Goblins, Take Two')
    },
  },
  {
    name: 'admin-settings',
    target: 'admin',
    hash: '#/settings',
    viewport: DESKTOP,
    themes: BOTH,
    ready: '.section-heading',
  },
]

const DEMO_CACHE = path.join(DEMO_DIR, 'cache')

// The demo keeps its card cache in its own `cache/` folder (`cacheDir: "cache"`
// in demo/ritual.config.json). Say so to every spawned CLI too, so a
// RITUAL_CACHE_DIR in the developer's shell cannot point a run elsewhere.
process.env.RITUAL_CACHE_DIR = 'cache'

/** The files git tracks under `demo/`, relative to it: never local state such as `.logins/`. */
function trackedDemoFiles(): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'demo'], { cwd: ROOT })
  if (result.exitCode !== 0) throw new Error(`git ls-files demo exited with ${result.exitCode}`)
  const files = result.stdout
    .toString()
    .split('\0')
    .filter((file) => file !== '')
    .map((file) => path.relative('demo', file))
  if (files.length === 0) throw new Error('git tracks no files under demo/')
  return files
}

/**
 * Copy the tracked `demo/` files into `workspace`, with the card cache: copied
 * under `never` (so a write cannot reach `demo/cache/`), linked otherwise (so a
 * download lands there). See the header comment.
 */
function copyDemo(workspace: string, refresh: RefreshMode): void {
  for (const file of trackedDemoFiles()) {
    mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true })
    cpSync(path.join(DEMO_DIR, file), path.join(workspace, file))
  }
  const cache = path.join(workspace, 'cache')
  if (refresh === 'never') {
    cpSync(DEMO_CACHE, cache, { recursive: true, mode: constants.COPYFILE_FICLONE })
  } else {
    mkdirSync(DEMO_CACHE, { recursive: true })
    symlinkSync(DEMO_CACHE, cache, 'dir')
  }
}

/** Run the CLI from source against `workspace`, failing on a non-zero exit. */
function ritual(workspace: string, args: readonly string[], stdin?: string): void {
  const result = Bun.spawnSync(
    ['bun', 'run', 'index.ts', '--base-dir', workspace, '--no-input', ...args],
    {
      cwd: ROOT,
      stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin),
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  if (result.exitCode !== 0)
    throw new Error(`ritual ${args.join(' ')} exited with ${result.exitCode}`)
}

function buildSite(
  workspace: string,
  outDir: string,
  refresh: RefreshMode,
  extra: readonly string[] = [],
): void {
  ritual(workspace, ['build-site', '--refresh', refresh, '--out-dir', outDir, ...extra])
}

/** Enable every price store whose prices come with the demo's cache. */
function enableStores(workspace: string): void {
  const file = path.join(workspace, 'ritual.config.json')
  const config: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`${file} does not hold a JSON object`)
  }
  ;(config as Record<string, unknown>).priceSources = ['tcgplayer', 'cardmarket', 'cardkingdom']
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * A loopback port nothing is listening on (`ritual admin` refuses port 0). Another
 * process could take it before `admin` binds; the start then fails and is rerun.
 */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const { port } = probe
  await probe.stop(true)
  if (port === undefined) throw new Error('no free port')
  return port
}

interface Running extends AsyncDisposable {
  url: string
}

/** Serve a built site on loopback. */
function serveSite(siteDir: string): Running {
  const server = serveStaticSite({ distDir: siteDir, port: 0, hostname: '127.0.0.1' })
  return { url: server.url.href, [Symbol.asyncDispose]: () => server.stop(true) }
}

/** Start `ritual admin` on loopback against `workspace`, with an account set up. */
async function startAdmin(workspace: string, refresh: RefreshMode): Promise<Running> {
  ritual(
    workspace,
    ['admin', 'setup', '--username', ADMIN_USER, '--password-stdin'],
    ADMIN_PASSWORD,
  )
  const port = await freePort()
  const child = Bun.spawn(
    [
      'bun',
      'run',
      'index.ts',
      '--base-dir',
      workspace,
      '--no-input',
      'admin',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--refresh',
      refresh,
      // The light captures switch this with `data-theme`; name the base explicitly.
      '--theme',
      'default',
    ],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
  )
  const running: Running = {
    url: `http://127.0.0.1:${port}/`,
    [Symbol.asyncDispose]: async () => {
      child.kill()
      // Force it down if a graceful shutdown takes too long.
      let timer: Timer | undefined
      const stopped = await Promise.race([
        child.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5_000)
        }),
      ])
      clearTimeout(timer)
      if (!stopped) {
        child.kill('SIGKILL')
        await child.exited
      }
    },
  }
  try {
    // Ready once it answers; give up if the process dies or a minute passes.
    const deadline = Date.now() + 60_000
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `ritual admin exited with ${child.exitCode ?? 'no code'} (signal ${child.signalCode ?? 'none'})`,
        )
      }
      if (Date.now() > deadline) throw new Error('ritual admin did not start within a minute')
      const answered = await fetch(running.url, { signal: AbortSignal.timeout(2_000) }).then(
        (response) => response.ok,
        () => false,
      )
      if (answered) return running
      await Bun.sleep(250)
    }
  } catch (error) {
    await running[Symbol.asyncDispose]()
    throw error
  }
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
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          animation.effect?.getComputedTiming().iterations !== Infinity,
      )
    // Capped, so an animation that keeps restarting cannot stall the run.
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ])
  })
  // One more frame pair so the decoded images are painted.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

/** Wait for the images in the capture to finish, at most this long. */
const IMAGE_WAIT_MS = 15_000

type ImageState = { loading: string[]; broken: string[] }

/**
 * The capture's visible images still loading, and those loaded broken. With
 * a `crop` selector, only that element's images. Runs in the page.
 */
function imageState(crop: string | null): ImageState {
  const scope = crop === null ? document : document.querySelector(crop)
  const visible = [...(scope?.querySelectorAll('img') ?? [])].filter((image) => {
    const box = image.getBoundingClientRect()
    return (
      box.bottom > 0 &&
      box.top < innerHeight &&
      box.width > 0 &&
      // Not a hidden hover preview.
      image.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
  })
  return {
    loading: visible.filter((image) => !image.complete).map((image) => image.src),
    broken: visible
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.src),
  }
}

/**
 * Fail when an image in the capture did not load, rather than capture its
 * broken icon. One still loading gets `IMAGE_WAIT_MS` to finish (lazy images
 * added by `prepare` may not have started when `settle` ran). With `crop`,
 * only the cropped element's images count: the page behind a modal may hold
 * lazy images the browser never loads.
 */
async function assertImagesLoaded(page: Page, shot: Shot): Promise<void> {
  const crop = shot.crop ?? null
  const deadline = Date.now() + IMAGE_WAIT_MS
  let state = await page.evaluate(imageState, crop)
  while (state.loading.length > 0 && Date.now() < deadline) {
    await page.waitForTimeout(250)
    state = await page.evaluate(imageState, crop)
  }
  const failed = [...state.loading, ...state.broken]
  if (failed.length > 0) throw new Error(`${shot.name}: images did not load: ${failed.join(', ')}`)
  await settle(page)
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

/** Screenshot the viewport, or the `crop` element with a margin, kept inside the viewport. */
async function capture(page: Page, shot: Shot): Promise<Buffer> {
  if (shot.crop === undefined) return page.screenshot()
  const box = await page.locator(shot.crop).boundingBox()
  if (!box) throw new Error(`${shot.name}: nothing to crop to at ${shot.crop}`)
  const x = Math.max(0, Math.floor(box.x - CROP_MARGIN))
  const y = Math.max(0, Math.floor(box.y - CROP_MARGIN))
  const right = Math.min(shot.viewport.width, Math.ceil(box.x + box.width + CROP_MARGIN))
  const bottom = Math.min(shot.viewport.height, Math.ceil(box.y + box.height + CROP_MARGIN))
  return page.screenshot({ clip: { x, y, width: right - x, height: bottom - y } })
}

async function takeShot(
  browser: Browser,
  shot: Shot,
  theme: Theme,
  baseUrl: string,
): Promise<void> {
  await using context = await browser.newContext({
    viewport: shot.viewport,
    colorScheme: theme,
    hasTouch: shot.touch ?? false,
    isMobile: shot.touch ?? false,
  })
  if (shot.target === 'admin') {
    // The admin bakes every theme into its stylesheet and picks one with the
    // root's `data-theme`; it has no theme switcher to drive.
    if (theme === 'light') {
      await context.addInitScript((name) => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.dataset.theme = name
        })
      }, SITE_THEME.light)
    }
    const login = await context.request.post(`${baseUrl}api/login`, {
      data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    })
    if (!login.ok()) throw new Error(`admin login failed with ${login.status()}`)
  } else {
    await context.addInitScript(
      ([key, value]) => {
        localStorage.setItem(key, value)
      },
      [THEME_STORAGE_KEY, SITE_THEME[theme]] as const,
    )
  }
  // Scryfall's image CDN sometimes refuses a card image's cache-busting URL
  // (`…jpg?1783926791`) while serving the same file without the query.
  await context.route('https://cards.scryfall.io/**', async (route) => {
    try {
      const response = await route.fetch()
      if (response.ok()) return await route.fulfill({ response })
      const url = new URL(route.request().url())
      url.search = ''
      await route.fulfill({ response: await route.fetch({ url: url.href }) })
    } catch {
      // The request failed (or the page closed): let the image fail, which
      // `assertImagesLoaded` reports if it was on screen.
      await route.abort().catch(() => undefined)
    }
  })
  try {
    const page = await context.newPage()
    await page.goto(`${baseUrl}${shot.hash}`)
    // The app renders after fetching its data; Scryfall card art marks that.
    await page
      .locator(shot.ready ?? CARD_IMAGE)
      .first()
      .waitFor()
    await settle(page)
    if (shot.prepare) {
      await shot.prepare(page)
      await settle(page)
    }
    await assertImagesLoaded(page, shot)
    const webp = await toWebp(page, await capture(page, shot))
    const file = path.join(OUT_DIR, `${shot.name}-${theme}.webp`)
    await Bun.write(file, webp)
    console.log(`${path.relative(ROOT, file)} (${Math.round(webp.length / 1024)} KB)`)
  } finally {
    // Before the context closes, so no handler outlives it.
    await context.unrouteAll({ behavior: 'ignoreErrors' })
  }
}

const { values } = parseArgs({
  options: {
    refresh: { type: 'string', default: 'never' },
    only: { type: 'string' },
  },
  strict: true,
})

function isRefreshMode(value: string): value is RefreshMode {
  return (REFRESH_MODES as readonly string[]).includes(value)
}
const refresh = values.refresh
if (!isRefreshMode(refresh)) {
  throw new Error(`--refresh must be one of ${REFRESH_MODES.join(', ')}, not ${refresh}`)
}
if (refresh === 'never' && !existsSync(DEMO_CACHE)) {
  throw new Error('demo/cache/ is missing; rerun with --refresh auto to download it')
}

const only = values.only
  ?.split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '')
if (only !== undefined) {
  if (only.length === 0) throw new Error('--only needs at least one shot name')
  const unknown = only.filter((name) => !SHOTS.some((shot) => shot.name.startsWith(name)))
  if (unknown.length > 0) throw new Error(`no shot matches --only ${unknown.join(', ')}`)
}
const selected = only
  ? SHOTS.filter((shot) => only.some((name) => shot.name.startsWith(name)))
  : SHOTS
const targets = new Set(selected.map((shot) => shot.target))

const tempRoot = mkdtempSync(path.join(tmpdir(), 'ritual-screenshots-'))
// Ctrl-C skips the `finally` below; remove the temporary copies anyway.
process.once('SIGINT', () => {
  rmSync(tempRoot, { recursive: true, force: true })
  process.exit(130)
})
try {
  mkdirSync(OUT_DIR, { recursive: true })
  // Children of the temp root, so build-site's sibling scratch directories
  // land inside it too and are removed with it.
  const workspace = path.join(tempRoot, 'demo')
  copyDemo(workspace, refresh)
  const baseUrls = new Map<Target, string>()
  await using stack = new AsyncDisposableStack()
  if (targets.has('site')) {
    const siteDir = path.join(tempRoot, 'site')
    buildSite(workspace, siteDir, refresh)
    baseUrls.set('site', stack.use(serveSite(siteDir)).url)
  }
  if (targets.has('stores')) {
    const storesWorkspace = path.join(tempRoot, 'demo-stores')
    copyDemo(storesWorkspace, refresh)
    enableStores(storesWorkspace)
    const siteDir = path.join(tempRoot, 'site-stores')
    buildSite(storesWorkspace, siteDir, refresh, ['--sell-mode'])
    baseUrls.set('stores', stack.use(serveSite(siteDir)).url)
  }
  if (targets.has('admin'))
    baseUrls.set('admin', stack.use(await startAdmin(workspace, refresh)).url)

  await using browser = await chromium.launch()
  for (const shot of selected) {
    const baseUrl = baseUrls.get(shot.target)
    if (baseUrl === undefined) throw new Error(`${shot.target} was not started`)
    for (const theme of shot.themes) await takeShot(browser, shot, theme, baseUrl)
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
