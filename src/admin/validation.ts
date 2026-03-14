/** Shared input-validation constants for admin API endpoints. */

/** Maximum allowed Content-Length for JSON request bodies (bytes).
 * Set to 10KiB to allow for a little wiggle room for bulk requests containing lots of cards or card names.
 */
export const MAX_BODY_SIZE = 10240

/** Maximum length for a username field. */
export const MAX_USERNAME_LENGTH = 64

/** Maximum length for a password field. */
export const MAX_PASSWORD_LENGTH = 128

/** Minimum length for a password field. */
export const MIN_PASSWORD_LENGTH = 8
