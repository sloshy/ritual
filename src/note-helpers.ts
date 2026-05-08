/**
 * Helpers for handling user-supplied note text on card list entries.
 *
 * Notes are stored inline in markdown card lines as `{note text}`. The serializer
 * uses an empty/undefined note interchangeably (no `{}` is emitted), so callers
 * coerce empty strings to `undefined` via {@link noteOrUndefined} before storage.
 */

export type NoteValidationResult = { ok: true; note: string } | { ok: false; error: string }

/**
 * Notes are single-line text. Reject any character in the C0 range (0x00–0x1F)
 * or DEL (0x7F) — that catches newlines, tabs, carriage returns, NULs, escape
 * sequences, etc. Quotes and other printable punctuation are allowed.
 */
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/

/**
 * Trim whitespace and validate a user-supplied note. Returns the cleaned text
 * (or empty string for "clear the note"), or a structured error if the note
 * contains control characters.
 *
 * Pass the result through {@link noteOrUndefined} when storing.
 */
export function normalizeNote(raw: string): NoteValidationResult {
  const trimmed = raw.trim()
  if (CONTROL_CHARS_RE.test(trimmed)) {
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
