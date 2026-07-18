/**
 * Backstop env for spawned-CLI tests that must never touch the network: point
 * every proxy-aware HTTP client at an unroutable address so the CLI cannot
 * reach Archidekt or Scryfall even when the machine is online. Suites using it
 * should still resolve everything locally (flag validation, stored tokens,
 * seeded caches) before any network call could happen.
 */
export const OFFLINE_ENV: Record<string, string> = {
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  http_proxy: 'http://127.0.0.1:9',
  https_proxy: 'http://127.0.0.1:9',
  NO_PROXY: '',
  no_proxy: '',
}
