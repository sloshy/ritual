import { MAX_SAVE_CHANGES, SAVE_CHANGE_BYTE_BUDGET } from '../changes/save-limits'
import { MAX_BODY_SIZE } from '../api/http'

/** Shared input-validation constants for admin API endpoints. */

/**
 * The budget for routes whose body is a batch of edits: a list save, a bulk
 * move or removal. A save carries only its change events — never the list —
 * so this scales with the edit, and is derived from the most events one save
 * may carry: {@link MAX_SAVE_CHANGES} at a generous 200 bytes each (a typical
 * wire event is 60–150). Relabelling every line of a five-figure collection is
 * one ordinary edit, and fits.
 */
export const MAX_EDIT_BODY_SIZE = MAX_SAVE_CHANGES * SAVE_CHANGE_BYTE_BUDGET

/**
 * The budget for routes whose body is a file the user hands over: a CSV or a
 * decklist to import, an exported change bundle, a rewritten changelog. These
 * are inherently as large as the file, so they get a budget of their own
 * rather than stretching the edit one.
 */
export const MAX_UPLOAD_BODY_SIZE = 16 * 1024 * 1024

/**
 * The budget for a metadata patch: a handful of fields, one of which may be a
 * deck's free-form description.
 */
export const MAX_METADATA_BODY_SIZE = 1024 * 1024

/**
 * The hard ceiling the admin server sets on every request body
 * (`maxRequestBodySize`). The runtime refuses a larger declared body before any
 * handler runs, and a chunked one as it is read (a body nothing reads is never
 * buffered at all). The largest route budget plus headroom, so a route always
 * gets to send its own JSON refusal first; each route holds its own, smaller
 * budget beneath it.
 */
export const MAX_ADMIN_REQUEST_BODY_SIZE =
  Math.max(MAX_BODY_SIZE, MAX_METADATA_BODY_SIZE, MAX_EDIT_BODY_SIZE, MAX_UPLOAD_BODY_SIZE) +
  64 * 1024

/** Maximum length for a username field. */
export const MAX_USERNAME_LENGTH = 64

/** Maximum length for a password field. */
export const MAX_PASSWORD_LENGTH = 128

/** Minimum length for a password field. */
export const MIN_PASSWORD_LENGTH = 8

/**
 * The query parameter `ritual admin`'s printed setup URL carries the one-time
 * setup token in (`src/admin/setup-token.ts`). Here rather than beside the
 * token so the setup form can read it without bundling `node:crypto`.
 */
export const SETUP_TOKEN_PARAM = 'setupToken'
