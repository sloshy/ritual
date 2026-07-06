/**
 * RFC 4180 CSV cell quoting shared by every CSV writer (editor exports and the
 * `ritual export` engine).
 *
 * By default a field is quoted only when it contains a comma, quote, or newline
 * (minimal quoting); pass `quoteAll` to force quotes around every field.
 * Embedded quotes are doubled either way.
 */
export const csvCell = (value: string, quoteAll = false): string =>
  quoteAll || /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
