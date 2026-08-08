/**
 * Path matching shared by the i18n lint rules.
 *
 * All three (`no-untranslated-literal`, `no-inline-plural`, `no-bare-intl-locale`)
 * decide where they apply from a list of directory/file fragments, and the plan's
 * ratchet — flip each rule to `error` per directory as that surface converts —
 * means those lists get edited repeatedly. One copy of the predicate, so a
 * Windows-separator fix or a matching-semantics change lands once.
 */

/** Windows gives ESLint backslash-separated paths; the fragments are always POSIX. */
function normalizePath(filename) {
  return filename.replace(/\\/g, '/')
}

/**
 * Whether `filename` sits under any of `fragments`.
 *
 * A fragment matches at the start of the path (`src/site/`, for a repo-relative
 * filename) or after any separator (`/src/site/`, for an absolute one), so the
 * same list works however ESLint reports the file.
 */
export function matchesAny(filename, fragments) {
  const normalized = normalizePath(filename)
  return fragments.some(
    (fragment) => normalized.startsWith(fragment) || normalized.includes(`/${fragment}`),
  )
}
