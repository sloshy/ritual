/**
 * The entry of a comma-separated forwarding header (`X-Forwarded-For`,
 * `X-Forwarded-Host`) that the reverse proxy appended: the rightmost one. The
 * leftmost entries are whatever the client sent, so they are never trusted.
 * Null when the header is absent or its last entry is empty. Read only under
 * `admin.trustProxy`.
 */
export function lastForwarded(value: string | null): string | null {
  const last = value?.split(',').at(-1)?.trim()
  return last === undefined || last === '' ? null : last
}
