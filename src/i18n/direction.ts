/**
 * A locale's writing direction — the one rule both SPAs stamp as `dir` and the
 * HTML shell's pre-paint boot script mirrors (`src/site-build/html-shell.ts`
 * interpolates {@link RTL_LANGUAGES} into it).
 *
 * Browser-safe leaf: no imports, so an SPA can read it without pulling the
 * shell's theme bootstrap into its bundle.
 */

/** Writing direction of a document. */
export type TextDirection = 'ltr' | 'rtl'

/**
 * Languages written right-to-left, by primary subtag. Only consulted when the
 * engine cannot answer for itself — `Intl.Locale.prototype.getTextInfo` is
 * recent, and older builds expose the same data as a `textInfo` accessor or not
 * at all.
 */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'he',
  'khw',
  'ks',
  'ps',
  'sd',
  'syr',
  'ug',
  'ur',
  'yi',
])

/** What ICU reports for a locale's writing direction, across both spellings. */
type LocaleTextInfo = { direction?: string }
type LocaleWithTextInfo = Intl.Locale & {
  getTextInfo?: () => LocaleTextInfo
  textInfo?: LocaleTextInfo
}

/**
 * The writing direction for a locale tag.
 *
 * `dir` is plumbed end to end, but no RTL locale ships until the CSS logical
 * -property sweep lands — so this is deliberately conservative and answers
 * `ltr` for anything it cannot resolve.
 */
export function localeDirection(tag: string): TextDirection {
  let locale: Intl.Locale
  try {
    locale = new Intl.Locale(tag)
  } catch {
    return 'ltr'
  }
  const withInfo = locale as LocaleWithTextInfo
  const direction = withInfo.getTextInfo?.().direction ?? withInfo.textInfo?.direction
  if (direction === 'rtl') return 'rtl'
  if (direction === 'ltr') return 'ltr'
  return RTL_LANGUAGES.has(locale.language.toLowerCase()) ? 'rtl' : 'ltr'
}
