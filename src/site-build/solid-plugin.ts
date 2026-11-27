/**
 * The Bun plugin that compiles Solid JSX with `@solidjs/compiler`, Solid's
 * native (Oxc) JSX compiler. Every `.tsx`/`.jsx` module the SPA bundles, the
 * from-source site and admin builds, and `bun test` load goes through it.
 *
 * The compiler rewrites JSX only: TypeScript syntax passes through untouched,
 * so a `.tsx` result goes back to Bun as `ts` (no JSX is left in it) and Bun
 * strips the types.
 *
 * `@solidjs/compiler` loads a native binding (`@solidjs/compiler-<platform>`)
 * when a module is first transformed. It is imported lazily, inside the load
 * hook, so a compiled `ritual` binary — which ships pre-built bundles and never
 * builds the SPAs — never evaluates it.
 */
import type { BunPlugin, Loader } from 'bun'
import path from 'node:path'
import { t } from '../i18n/t'
import { getErrorMessage } from '../util/errors'

/**
 * No source-map option: neither `Bun.build` nor Bun's runtime loader chains a
 * map a plugin hands back (checked on Bun 1.4.5 — bundle maps and stack traces
 * both point into the compiled code either way), so emitting one buys nothing.
 */
export type SolidPluginOptions = {
  /** `dom` for the browser bundles, `ssr` for `bun test` (which resolves Solid's server build). */
  generate: 'dom' | 'ssr'
  /** Compile in dev mode (dev-only diagnostics and source names). */
  dev?: boolean
}

const JSX_FILE = /\.[jt]sx$/

/** The Bun loader that parses what the compiler hands back for `file`. */
function loaderFor(file: string): Loader {
  return path.extname(file) === '.jsx' ? 'js' : 'ts'
}

export function solidPlugin(options: SolidPluginOptions): BunPlugin {
  const { generate, dev = false } = options
  return {
    name: 'ritual-solid',
    setup(build) {
      build.onLoad({ filter: JSX_FILE, namespace: 'file' }, async ({ path: file }) => {
        // Packages ship compiled JavaScript; only Ritual's own sources are JSX.
        if (file.includes(`${path.sep}node_modules${path.sep}`)) return undefined
        const { transform } = await import('@solidjs/compiler')
        const source = await Bun.file(file).text()
        let code: string
        try {
          code = transform(source, { filename: file, generate, dev }).code
        } catch (cause) {
          throw new Error(
            t('cli.buildSite.jsxCompileFailed', { file, reason: getErrorMessage(cause) }),
            { cause },
          )
        }
        return { loader: loaderFor(file), contents: code }
      })
    },
  }
}
