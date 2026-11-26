import { createHash } from 'node:crypto'
import { localeDirection } from '../../i18n/direction'
import { currentLocale } from '../../i18n/runtime'
import { t, type ParameterlessKey } from '../../i18n/t'
import { escapeHtml } from '../../util/html-escape'

/**
 * The login + consent page and the error page of `/oauth/authorize`:
 * server-rendered, no script, no external asset. Every string is in the
 * server's UI locale, and every value that reached here from a client (its
 * name, its redirect host) or from the catalog is HTML-escaped as a whole.
 */

/** The page's stylesheet, inline; the CSP admits exactly this text by its hash. */
const STYLE = `
:root { color-scheme: light dark; --bg: #f5f5f4; --card: #ffffff; --text: #1c1917;
  --muted: #57534e; --border: #d6d3d1; --accent: #b45309; --accent-text: #ffffff; --error: #b91c1c; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --card: #292524; --text: #f5f5f4;
  --muted: #a8a29e; --border: #44403c; --accent: #f59e0b; --accent-text: #1c1917; --error: #f87171; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: var(--bg); color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; padding: 24px; }
h1 { font-size: 1.35rem; margin: 0 0 12px; overflow-wrap: anywhere; }
p { margin: 0 0 12px; overflow-wrap: anywhere; }
.muted { color: var(--muted); font-size: 0.95rem; }
code { font-size: 0.95rem; overflow-wrap: anywhere; }
.error { color: var(--error); font-weight: 600; }
label { display: block; margin: 12px 0 4px; font-weight: 600; }
input { width: 100%; padding: 8px 10px; font: inherit; color: inherit; background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; }
.actions { display: flex; gap: 12px; margin-top: 20px; }
button { flex: 1; padding: 10px; font: inherit; font-weight: 600; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border); background: transparent; color: var(--text); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
`

/** The CSP source that admits {@link STYLE}. */
const STYLE_SOURCE = `'sha256-${createHash('sha256').update(STYLE, 'utf8').digest('base64')}'`

/**
 * The `form-action` source that admits a redirect to `redirectOrigin`.
 * Chromium ignores an IPv6 host source (`http://[::1]:4567`), so an IPv6
 * loopback redirect is admitted by its scheme (`http:`) instead. The page runs
 * no script and renders nothing a client controls as markup, so the wider
 * source admits no form but Ritual's own.
 */
function formTarget(redirectOrigin: string): string {
  return /^http:\/\/\[/.test(redirectOrigin) ? 'http:' : redirectOrigin
}

/**
 * The Content-Security-Policy of either page. `form-action` names the client's
 * redirect origin as well as this page's own: browsers apply it to the
 * redirect that follows the form's submission, so without it the approval
 * could not reach the client.
 */
export function pageContentSecurityPolicy(redirectOrigin?: string): string {
  const formAction =
    redirectOrigin === undefined ? "'self'" : `'self' ${formTarget(redirectOrigin)}`
  // i18n-exempt: Content-Security-Policy directives, machine syntax
  return [
    "default-src 'none'",
    `style-src ${STYLE_SOURCE}`,
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/** The document around a page body, in the server's UI locale. */
function documentHtml(title: string, body: string): string {
  const lang = currentLocale()
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${localeDirection(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}

/**
 * A sign-in problem shown above the form. A wrong password and a wrong or
 * missing authenticator code are one message, so the page never confirms a
 * password on its own.
 */
export type ConsentPageError = 'invalidCredentials' | 'rateLimited' | 'busy'

const CONSENT_ERROR_KEYS: Record<ConsentPageError, ParameterlessKey> = {
  invalidCredentials: 'cli.mcp.oauth.page.error.invalidCredentials',
  rateLimited: 'cli.mcp.oauth.page.error.rateLimited',
  busy: 'cli.mcp.oauth.page.error.busy',
}

/** What the consent page shows and submits. */
export type ConsentPageView = {
  /** The client's registered name, or `undefined` for a client that gave none. */
  clientName?: string
  /** The host (with port) the browser returns to afterwards. */
  redirectHost: string
  /** The pending request this page answers, and its CSRF token. */
  requestId: string
  csrfToken: string
  /** Ask for an authenticator code too. */
  totpEnabled: boolean
  error?: ConsentPageError
}

/** The login + consent page. */
export function renderConsentPage(view: ConsentPageView): string {
  const client = view.clientName ?? t('cli.mcp.oauth.page.unnamedClient')
  const error =
    view.error === undefined
      ? ''
      : `<p class="error" role="alert">${escapeHtml(t(CONSENT_ERROR_KEYS[view.error]))}</p>\n`
  const totp = view.totpEnabled
    ? `<label for="totp">${escapeHtml(t('cli.mcp.oauth.page.totp'))}</label>
<input id="totp" name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
`
    : ''
  const body = `<h1>${escapeHtml(t('cli.mcp.oauth.page.heading', { client }))}</h1>
<p>${escapeHtml(t('cli.mcp.oauth.page.intro', { client }))}</p>
<p class="muted">${escapeHtml(t('cli.mcp.oauth.page.returnsTo'))} <code>${escapeHtml(view.redirectHost)}</code></p>
<p class="muted">${escapeHtml(t('cli.mcp.oauth.page.signIn'))}</p>
${error}<form method="post" action="/oauth/authorize">
<input type="hidden" name="request_id" value="${escapeHtml(view.requestId)}">
<input type="hidden" name="csrf" value="${escapeHtml(view.csrfToken)}">
<label for="username">${escapeHtml(t('cli.mcp.oauth.page.username'))}</label>
<input id="username" name="username" autocomplete="username" required>
<label for="password">${escapeHtml(t('cli.mcp.oauth.page.password'))}</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
${totp}<div class="actions">
<button class="primary" type="submit" name="action" value="approve">${escapeHtml(t('cli.mcp.oauth.page.approve'))}</button>
<button type="submit" name="action" value="deny" formnovalidate>${escapeHtml(t('cli.mcp.oauth.page.deny'))}</button>
</div>
</form>`
  return documentHtml(t('cli.mcp.oauth.page.title'), body)
}

/** Why the error page is shown instead of the consent page. */
export type ErrorPageReason =
  | 'invalidRequest'
  | 'expired'
  | 'tooManyAttempts'
  | 'tooManyPages'
  | 'forbidden'
  | 'unavailable'
  | 'serverError'

const ERROR_PAGE_KEYS: Record<ErrorPageReason, ParameterlessKey> = {
  invalidRequest: 'cli.mcp.oauth.page.failed.invalidRequest',
  expired: 'cli.mcp.oauth.page.failed.expired',
  tooManyAttempts: 'cli.mcp.oauth.page.failed.tooManyAttempts',
  tooManyPages: 'cli.mcp.oauth.page.failed.tooManyPages',
  forbidden: 'cli.mcp.oauth.page.failed.forbidden',
  unavailable: 'cli.mcp.oauth.page.failed.unavailable',
  serverError: 'cli.mcp.oauth.page.failed.serverError',
}

/**
 * The page shown when the browser cannot be sent back to the client: the
 * request named an unknown client or an unregistered redirect URI, expired, or
 * failed its CSRF check. It names nothing from the request.
 */
export function renderErrorPage(reason: ErrorPageReason): string {
  const title = t('cli.mcp.oauth.page.failed.title')
  const body = `<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(t(ERROR_PAGE_KEYS[reason]))}</p>`
  return documentHtml(title, body)
}
