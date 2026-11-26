/**
 * The value of cookie `name` in a `Cookie` request header, or `null` when the
 * header is absent or does not carry it. The first occurrence wins. Values are
 * returned as sent; callers validate their own format.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const prefix = `${name}=`
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length)
  }
  return null
}
