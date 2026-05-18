// Runtime theme state for the public site.
//
// Owns:
//   - the active theme name (built-in like "boros", a `--theme-file`-supplied
//     custom name, or the special "custom" sentinel for in-browser edits),
//   - the in-progress custom variable overrides (when the user is editing),
//   - whether the editor toolbar is open.
//
// Persists everything to localStorage so reloads land back where the user
// left off. The bootstrap script in `index.html` applies the saved theme
// before the stylesheet resolves to prevent FOUC; this module rehydrates
// the same state into Solid signals after the SPA mounts.

import {
  batch,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  useContext,
} from 'solid-js'
import type { JSX } from 'solid-js'
import type { ThemeCssVars, ThemeName } from '../themes'

// Keep these key names in sync with `themeBootstrapScript` in `src/themes.ts`.
const LS_THEME = 'ritual:theme'
const LS_CUSTOM_VARS = 'ritual:custom-vars'
const LS_EDITOR_OPEN = 'ritual:theme-editor-open'

// Open-ended theme name. `ThemeName` is known at compile time and gets
// autocompletion; `string & {}` keeps the union from collapsing to plain
// `string` while still accepting arbitrary names supplied by `--theme-file`
// at build time. There is no "custom" sentinel — customizations are tracked
// independently of the base theme via the customVars signal.
export type ActiveTheme = ThemeName | (string & {})

// Validate-and-coerce a value parsed from localStorage into a `ThemeCssVars`
// dict. `JSON.parse` returns `unknown`; the result of this function is
// applied directly to `style.textContent`, so untrusted shapes must be
// filtered out rather than passed through with a blind cast.
function coerceCustomVars(value: unknown): ThemeCssVars {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: ThemeCssVars = {}
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('--') && typeof v === 'string' && v.length > 0) {
      out[k] = v
    }
  }
  return out
}

function readCustomVarsFromStorage(): ThemeCssVars {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_VARS)
    if (!raw) return {}
    return coerceCustomVars(JSON.parse(raw))
  } catch {
    return {}
  }
}

function readString(key: string, fallback: string | null = null): string | null {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeString(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* localStorage unavailable — gracefully no-op */
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* unavailable */
  }
}

// Read the current resolved value of a CSS variable on `:root`. Excludes any
// inline custom-vars override on :root, so we see the value that *would*
// apply if the override were removed (i.e. the base theme's value). This is
// how "Reset to base theme" knows what to fall back to.
export function readCssVar(name: string): string {
  const html = document.documentElement
  const inline = html.style.getPropertyValue(name)
  if (!inline) return getComputedStyle(html).getPropertyValue(name).trim()
  // Temporarily strip our override so getComputedStyle resolves against the
  // cascade alone (the active theme's stylesheet rule), then restore it.
  html.style.removeProperty(name)
  const resolved = getComputedStyle(html).getPropertyValue(name).trim()
  html.style.setProperty(name, inline)
  return resolved
}

// Apply the custom-vars dict as inline styles on `:root`. Inline styles
// outrank any stylesheet rule, so overrides win regardless of which base
// theme is active — and removing an entry from the dict makes that var fall
// back to the active theme's stylesheet rule, not to the default theme.
// Tracks the previously-applied keys so vars dropped between calls get
// removed from the inline style rather than lingering. Seeded from the
// bootstrap script's initial application so the very first `unsetVar` can
// clean up vars set during pre-mount.
const lastAppliedKeys = new Set<string>()
function applyCustomVarsInline(vars: ThemeCssVars): void {
  const html = document.documentElement
  for (const key of lastAppliedKeys) {
    if (!(key in vars)) {
      html.style.removeProperty(key)
      lastAppliedKeys.delete(key)
    }
  }
  for (const [key, value] of Object.entries(vars)) {
    html.style.setProperty(key, value)
    lastAppliedKeys.add(key)
  }
}

export type ThemeStore = ReturnType<typeof createThemeStore>

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- ThemeStore is intentionally derived from this function's inferred shape via ReturnType so the two stay in sync.
export function createThemeStore() {
  // ---- Initial values from the bootstrap script in index.html ----
  const initialThemeAttr = document.documentElement.dataset.theme ?? 'default'
  const initialCustomVars = readCustomVarsFromStorage()
  const initialEditorOpen = readString(LS_EDITOR_OPEN) === '1'

  const [theme, setThemeSignal] = createSignal<ActiveTheme>(initialThemeAttr)
  const [customVars, setCustomVars] = createSignal<ThemeCssVars>(initialCustomVars)
  const [editorOpen, setEditorOpen] = createSignal(initialEditorOpen)

  // Coerce stale localStorage from earlier dev builds, which used a `'custom'`
  // sentinel theme. Treat it as default so the cascade resolves to the bare
  // `:root` rule rather than a dangling `data-theme="custom"` attribute.
  if (initialThemeAttr === 'custom') {
    document.documentElement.removeAttribute('data-theme')
    writeString(LS_THEME, null)
  }

  // Seed the inline-keys tracker so unsetVar can clean up vars that the
  // bootstrap script applied before this module mounted.
  for (const key of Object.keys(initialCustomVars)) lastAppliedKeys.add(key)

  // The data-theme attribute is updated synchronously inside this wrapper so
  // it lands in the DOM before any observer fires. Memos that call
  // `getComputedStyle` would otherwise run before a deferred effect could
  // update the attribute and see the old theme's values.
  function setTheme(t: ActiveTheme): void {
    const html = document.documentElement
    if (t === 'default') html.removeAttribute('data-theme')
    else html.dataset.theme = t
    setThemeSignal(t)
  }

  createEffect(
    on(
      theme,
      (t) => {
        writeString(LS_THEME, t === 'default' ? null : t)
      },
      { defer: true },
    ),
  )

  // The DOM style is applied synchronously inside the setters below (so any
  // observer that calls `getComputedStyle` after a customVars change sees the
  // up-to-date value). This effect just handles the localStorage write.
  createEffect(
    on(
      customVars,
      (vars) => {
        writeJson(LS_CUSTOM_VARS, Object.keys(vars).length > 0 ? vars : null)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(editorOpen, (open) => {
      writeString(LS_EDITOR_OPEN, open ? '1' : null)
      document.body.classList.toggle('theme-editor-active', open)
    }),
  )

  // If the store is ever disposed, leave the body class clean.
  onCleanup(() => {
    document.body.classList.remove('theme-editor-active')
  })

  // ---- Editor mutators ----

  // Each mutator applies the new dict to `:root`'s inline style synchronously
  // (inside the updater) so the DOM is in its new state before any reactive
  // observers fire. In particular, the editor's swatch memos read
  // `getComputedStyle` and would otherwise race with a deferred effect and
  // pick up the stale value.
  function commit(next: ThemeCssVars): ThemeCssVars {
    applyCustomVarsInline(next)
    return next
  }

  function setVar(name: string, value: string): void {
    setCustomVars((prev) => commit({ ...prev, [name]: value }))
  }

  function unsetVar(name: string): void {
    setCustomVars((prev) => {
      if (!(name in prev)) return prev
      const next = { ...prev }
      delete next[name]
      return commit(next)
    })
  }

  // Replace the entire custom-vars dict (used when importing JSON or
  // resetting to a built-in theme).
  function replaceCustomVars(vars: ThemeCssVars): void {
    setCustomVars(commit(vars))
  }

  function clearCustomVars(): void {
    setCustomVars(commit({}))
  }

  // Atomically swap the base theme and discard any inline overrides. Both
  // mutations need to land in one reactive flush so observers never see a
  // mid-flight state where the new palette is active but the user's old
  // overrides are still layered on top of it.
  function switchBaseTheme(name: ActiveTheme): void {
    batch(() => {
      clearCustomVars()
      setTheme(name)
    })
  }

  return {
    // signals
    theme,
    customVars,
    editorOpen,
    // setters
    setTheme,
    setEditorOpen,
    setVar,
    unsetVar,
    replaceCustomVars,
    clearCustomVars,
    switchBaseTheme,
  }
}

// ---------------------------------------------------------------------------
// Context plumbing
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeStore | undefined>(undefined)

type ThemeProviderProps = {
  store: ThemeStore
  children: JSX.Element
}

export function ThemeProvider(props: ThemeProviderProps): JSX.Element {
  return <ThemeContext.Provider value={props.store}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): ThemeStore {
  const store = useContext(ThemeContext)
  if (!store) throw new Error('useTheme must be used inside <ThemeProvider>')
  return store
}
