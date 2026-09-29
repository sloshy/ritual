/**
 * Helpers for handling user-supplied note text on card list entries.
 *
 * Notes are stored inline in markdown card lines as `{note text}`. The serializer
 * uses an empty/undefined note interchangeably (no `{}` is emitted), so callers
 * coerce empty strings to `undefined` via {@link noteOrUndefined} before storage.
 */

import { hasControlOrSeparator } from '../util/single-line'

export type NoteValidationResult = { ok: true; note: string } | { ok: false; error: string }

/**
 * Trim whitespace and validate a user-supplied note. Returns the cleaned text
 * (or empty string for "clear the note"), or a structured error if the note
 * contains control characters.
 *
 * Pass the result through {@link noteOrUndefined} when storing.
 */
export function normalizeNote(raw: string): NoteValidationResult {
  const trimmed = raw.trim()
  // Notes are single-line text: any control character (newline, tab, NUL, an
  // escape sequence, NEL) or Unicode line separator is refused. Quotes and other
  // printable punctuation are allowed.
  if (hasControlOrSeparator(trimmed)) {
    return {
      ok: false,
      error:
        'Notes must be single-line text with no control characters (newlines, tabs, etc. are not allowed).',
    }
  }
  return { ok: true, note: trimmed }
}

/** Empty note text is stored as `undefined` (no `{}` segment in serialized lines). */
export function noteOrUndefined(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  return note === '' ? undefined : note
}
