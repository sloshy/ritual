import { Command } from 'commander'
import path from 'node:path'
import { watch } from 'node:fs'
import { getBaseDir } from '../base-dir'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'
import { getErrorMessage } from '../errors'
import { applyBuildSiteOptions, runBuildSite, type BuildSiteOptions } from './build-site'
import { serveStaticSite } from './serve-helpers'
import { createRebuildQueue } from './rebuild-queue'

type ServeSiteCliOptions = BuildSiteOptions & {
  port: string
  host: string
  dev?: boolean
}

type WatchedDir = {
  dir: string
  label: string
  filter: (filename: string) => boolean
}

const REBUILD_DEBOUNCE_MS = 200

export function registerServeSiteCommand(program: Command) {
  const command = program
    .command('serve-site')
    .description('Build the static site and serve it (with optional dev rebuild watcher)')
    .option('-p, --port <number>', 'Port to serve on', '3000')
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .option(
      '--dev',
      'Rebuild the site when source files (src/) or data files (decks/, collections/, wanted/) change',
    )

  applyBuildSiteOptions(command).action(async (options: ServeSiteCliOptions) => {
    const port = parseInt(options.port, 10)
    const hostname = options.host
    const devMode = options.dev === true

    const buildOptions: BuildSiteOptions = {
      verbose: options.verbose,
      cacheImages: options.cacheImages,
      decks: options.decks,
      collections: options.collections,
      wantedLists: options.wantedLists,
      collectionSort: options.collectionSort,
      deckSort: options.deckSort,
      currencies: options.currencies,
      // In dev mode, never block on a prompt — there is no human at the
      // terminal between watch-triggered rebuilds.
      yes: devMode ? true : options.yes,
      theme: options.theme,
      themeFile: options.themeFile,
      devSourceBuild: devMode,
    }

    console.log('Building site...')
    try {
      await runBuildSite(buildOptions)
    } catch (err) {
      console.error('Initial build failed:', getErrorMessage(err))
      process.exit(1)
    }

    const distDir = path.join(getBaseDir(), 'dist')
    console.log(`Serving site from ${distDir} at http://localhost:${port}...`)
    serveStaticSite({ distDir, port, hostname })

    if (devMode) {
      startDevWatcher(buildOptions)
    }
  })
}

function startDevWatcher(buildOptions: BuildSiteOptions): void {
  const baseDir = getBaseDir()
  const srcDir = path.join(import.meta.dir, '..', '..', 'src')
  const decksDir = getDecksDir()
  const collectionsDir = getCollectionsDir()
  const wantedDir = getWantedDir()

  const queue = createRebuildQueue<null>({
    rebuild: async () => {
      console.log('[dev] Rebuilding site...')
      await runBuildSite(buildOptions)
      console.log('[dev] Rebuild complete.')
    },
    onError: (err) => {
      console.error('[dev] Rebuild failed:', getErrorMessage(err))
    },
  })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleRebuild = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      queue.trigger(null)
    }, REBUILD_DEBOUNCE_MS)
  }

  const watchedDirs: WatchedDir[] = [
    { dir: srcDir, label: 'source', filter: isSourceFile },
    { dir: decksDir, label: 'decks', filter: isMarkdownFile },
    { dir: collectionsDir, label: 'collections', filter: isMarkdownFile },
    { dir: wantedDir, label: 'wanted', filter: isMarkdownFile },
  ]

  for (const { dir, label, filter } of watchedDirs) {
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        if (!filter(filename)) return
        scheduleRebuild()
      })
      const rel = path.relative(baseDir, dir) || dir
      console.log(`[dev] Watching ${rel} for ${label} changes...`)
    } catch {
      // Directory may not exist (e.g. no collections/ yet) — silently skip.
    }
  }
}

function isSourceFile(filename: string): boolean {
  return (
    filename.endsWith('.ts') ||
    filename.endsWith('.tsx') ||
    filename.endsWith('.css') ||
    filename.endsWith('.svg')
  )
}

function isMarkdownFile(filename: string): boolean {
  return filename.endsWith('.md')
}
