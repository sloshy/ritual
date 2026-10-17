/**
 * The one HTML shell both SPAs are served from.
 *
 * `build-site` and `admin` each used to carry their own `<!DOCTYPE html>`
 * template literal, both hardcoding `<html lang="en">` with no `dir` and both
 * inlining the theme bootstrap. That last part was a live bug: the admin server
 * sets `script-src 'self'`, so its inline bootstrap was blocked by its own CSP
 * and the theme flashed on every load. Collapsing the two shells here and
 * moving the bootstrap into an **external, same-origin `boot.js`** fixes it for
 * both, and gives the locale bootstrap somewhere to live that will not repeat
 * the mistake.
 *
 * Node-side: this module renders markup for the build and the admin start-up.
 * The script it emits is the only part that runs in a browser, and it is a
 * plain string.
 */

import { themeBootstrapScript } from '../theme/themes'
import type { LocaleTag } from '../i18n/types'
import { localeDirection, RTL_LANGUAGES } from '../i18n/direction'

/** Everything {@link renderAppShell} needs. Nothing is read ambiently. */
export type AppShellOptions = {
  /** BCP-47 tag stamped as `<html lang>`; `dir` is derived from it. */
  lang: LocaleTag
  /** Contents of `<title>`. Must be plain text. */
  title: string
  /**
   * The theme baked into the markup. `default` emits no `data-theme`
   * attribute, matching the CSS, which treats the absence as the default.
   */
  initialTheme: string
  /** `<meta name="viewport">` content. Defaults to the plain responsive value. */
  viewport?: string
  /** Markup appended verbatim inside `<head>`, after the stylesheet. */
  extraHead?: string
}

/** The file name both callers write {@link appBootScript} to, and the shell loads. */
export const BOOT_SCRIPT_FILE = 'boot.js'

/**
 * The shape a `lang` attribute value may take. Declared before
 * {@link appBootScript} so the boot script can interpolate its source rather
 * than restate it — see {@link RTL_PATTERN}.
 */
const SAFE_LANG = /^[A-Za-z0-9-]+$/

/**
 * {@link RTL_LANGUAGES} as a regex, generated from the set.
 *
 * The pre-paint boot script cannot import anything, so it needs the rule inline
 * — but it is a template literal, so the rule can be *interpolated* instead of
 * copied. Written out by hand, adding a language to the set would change
 * {@link localeDirection} and leave the bootstrap stamping `dir="ltr"`: a flash
 * of the wrong writing direction on the very first paint, which is the hardest
 * place to notice one.
 */
const RTL_PATTERN = new RegExp(`^(${[...RTL_LANGUAGES].join('|')})(-|$)`, 'i')

/**
 * The bootstrap that runs before first paint, served as a static file so a
 * `script-src 'self'` policy accepts it.
 *
 * Two jobs, both of which must happen before the SPA's JS parses or the user
 * sees a flash of the wrong theme / the wrong writing direction:
 *
 * 1. Apply the stored theme and any custom theme variables (unchanged from the
 *    inline bootstrap it replaces).
 * 2. Stamp `lang` and `dir` from the locale the app is about to resolve. The
 *    precedence mirrors the app's own (`__ritualLocale__` test seam, then the
 *    `?locale=` hash query, then localStorage); the tiers below those need data
 *    the shell does not have, and the baked `lang` already carries them.
 */
export const appBootScript = `${themeBootstrapScript}
  try {
    var el = document.documentElement;
    var loc = window.__ritualLocale__;
    if (!loc) {
      var h = String(location.hash || '');
      var q = h.indexOf('?');
      if (q >= 0) loc = new URLSearchParams(h.slice(q + 1)).get('locale');
    }
    if (!loc) loc = localStorage.getItem('ritual:locale');
    if (loc && ${SAFE_LANG}.test(loc)) {
      el.lang = loc;
      el.dir = ${RTL_PATTERN}.test(loc) ? 'rtl' : 'ltr';
    }
  } catch (e) {}
`

/**
 * Theme names reach here already validated (`resolveThemeName` for the
 * built-ins, `parseCustomTheme` for `--theme-file`), and locale tags come from
 * `parseLocaleTag`. Re-checking at the interpolation site is defense in depth:
 * a future refactor that loses a validator must not be able to turn either
 * value into attribute injection.
 */
const SAFE_THEME = /^[a-z0-9][a-z0-9-]*$/

/** Escape the only characters that can break out of an element's text content. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Render the shared `index.html` shell. */
export function renderAppShell(options: AppShellOptions): string {
  const lang = SAFE_LANG.test(options.lang) ? options.lang : 'en'
  const dir = localeDirection(lang)
  const theme = SAFE_THEME.test(options.initialTheme) ? options.initialTheme : 'default'
  const themeAttr = theme === 'default' ? '' : ` data-theme="${theme}"`
  const viewport = options.viewport ?? 'width=device-width, initial-scale=1.0'
  const extraHead = options.extraHead ?? ''
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}"${themeAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="${viewport}">
  <title>${escapeText(options.title)}</title>
  <link rel="icon" type="image/svg+xml" href="app.svg">
  <script src="${BOOT_SCRIPT_FILE}"></script>
  <link rel="stylesheet" href="styles.css">${extraHead}
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>`
}
