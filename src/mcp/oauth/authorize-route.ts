import { isTotpEnabled } from '../../admin/auth'
import type { LoginLimitSettings } from '../../admin/login-attempt'
import { apiText } from '../../api/result'
import type { ParameterlessKey } from '../../i18n/t'
import { readCookie } from '../../util/cookie'
import { secretsEqual } from '../../util/secret-compare'
import { isHttpsOrigin } from '../public-url'
import { addressKey } from '../../util/address-key'
import {
  clientRedirectUrl,
  isAuthorizationRefusal,
  validateAuthorizationRequest,
  type AuthorizationRefusalDetail,
} from './authorization'
import type { OAuthAuthorizationServer, PendingAuthorization } from './authorization-server'
import { verifyConsentLogin } from './login'
import {
  renderConsentPage,
  renderErrorPage,
  type ConsentPageError,
  type ErrorPageReason,
} from './page'
import {
  AUTHORIZE_WINDOW_MINUTES,
  BUSY_RETRY_AFTER_SECONDS,
  MAX_AUTHORIZE_PAGES_PER_WINDOW,
  MAX_FAILED_ATTEMPTS_PER_PAGE,
} from './policy'
import { isBodyProblem, readForm } from './request-body'
import { clientRedirect, htmlPage } from './responses'
import { SECRET_PATTERN } from './secrets'

/** Who is asking, as the router resolved it under the `admin.*` settings. */
export type AuthorizeContext = {
  clientIp: string
  userAgent: string
  settings: LoginLimitSettings
}

/** The English description sent with each refusal redirected to the client. */
const REFUSAL_KEYS: Record<AuthorizationRefusalDetail, ParameterlessKey> = {
  duplicate: 'cli.mcp.oauth.error.authorize.duplicate',
  responseType: 'cli.mcp.oauth.error.authorize.responseType',
  pkceMissing: 'cli.mcp.oauth.error.authorize.pkceMissing',
  pkceMethod: 'cli.mcp.oauth.error.authorize.pkceMethod',
  pkceMalformed: 'cli.mcp.oauth.error.authorize.pkceMalformed',
  resource: 'cli.mcp.oauth.error.authorize.resource',
  stateTooLong: 'cli.mcp.oauth.error.authorize.stateTooLong',
}

/**
 * The cookie that ties a consent form to the browser it was shown in
 * (double-submit CSRF protection beside the per-page token). `SameSite=Lax`
 * is what lets the browser keep it across the client's cross-site redirect
 * to this page while still withholding it from a cross-site form post. Over
 * https it carries the `__Host-` prefix, which pins it to this exact origin
 * (`Secure`, `Path=/`, no `Domain`).
 */
type CsrfCookie = { name: string; attributes: string }

function csrfCookie(server: OAuthAuthorizationServer): CsrfCookie {
  if (isHttpsOrigin(server.publicUrl)) {
    return {
      name: '__Host-ritual_oauth_csrf',
      attributes: 'Path=/; HttpOnly; SameSite=Lax; Secure', // i18n-exempt: Set-Cookie attributes
    }
  }
  // i18n-exempt: Set-Cookie attributes, machine syntax
  return { name: 'ritual_oauth_csrf', attributes: 'Path=/oauth/authorize; HttpOnly; SameSite=Lax' }
}

/** This browser's CSRF cookie, when it carries one Ritual could have minted. */
function browserCookie(request: Request, cookie: CsrfCookie): string | undefined {
  const value = readCookie(request.headers.get('Cookie'), cookie.name)
  return value !== null && SECRET_PATTERN.test(value) ? value : undefined
}

function errorPage(reason: ErrorPageReason, status: number, retryAfter?: number): Response {
  return htmlPage(renderErrorPage(reason), status, retryAfter === undefined ? {} : { retryAfter })
}

/**
 * The consent page for `pending`, optionally with a sign-in problem. Its CSP
 * admits the client's redirect origin as a form target, so the approval's
 * redirect is not blocked.
 */
function consentPage(
  pending: PendingAuthorization,
  totpEnabled: boolean,
  status: number,
  error?: ConsentPageError,
  setCookie?: string,
  retryAfter?: number,
): Response {
  const redirect = new URL(pending.request.redirectUri)
  const html = renderConsentPage({
    ...(pending.request.clientName === undefined ? {} : { clientName: pending.request.clientName }),
    redirectHost: redirect.host,
    requestId: pending.requestId,
    csrfToken: pending.csrfToken,
    totpEnabled,
    ...(error === undefined ? {} : { error }),
  })
  return htmlPage(html, status, {
    redirectOrigin: redirect.origin,
    ...(setCookie === undefined ? {} : { setCookie }),
    ...(retryAfter === undefined ? {} : { retryAfter }),
  })
}

/**
 * `GET /oauth/authorize`: validate the request and show the login + consent
 * page. A request whose client or redirect URI cannot be trusted gets Ritual's
 * own error page and is never redirected; every later problem is redirected to
 * the client with the RFC 6749 error code and its `state`. Each address may
 * open only so many valid pages per window (a request that fails validation
 * costs nothing, so junk cannot use up the owner's budget), and hold only so
 * many open at once; a full table makes room from the address holding the most.
 */
export async function handleAuthorizeGet(
  server: OAuthAuthorizationServer,
  request: Request,
  context: AuthorizeContext,
): Promise<Response> {
  const address = addressKey(context.clientIp)
  const limiter = server.authorizePageLimiter
  if (limiter.isLocked(address)) return errorPage('tooManyPages', 429)

  const url = new URL(request.url)
  const validated = validateAuthorizationRequest(
    url.searchParams,
    await server.clients(),
    server.endpoints.resource,
  )
  if (isAuthorizationRefusal(validated)) {
    if (validated.kind === 'page') return errorPage('invalidRequest', 400)
    return clientRedirect(
      clientRedirectUrl(validated.redirectUri, server.endpoints.issuer, {
        error: validated.error,
        error_description: apiText(REFUSAL_KEYS[validated.detail]),
        state: validated.state,
      }),
    )
  }
  // Checked again and counted together, synchronously, now the request is
  // known to be valid: parallel requests see each other's count.
  if (limiter.isLocked(address)) return errorPage('tooManyPages', 429)
  limiter.recordFailure(address, MAX_AUTHORIZE_PAGES_PER_WINDOW, AUTHORIZE_WINDOW_MINUTES)
  const cookie = csrfCookie(server)
  const existing = browserCookie(request, cookie)
  const value = existing ?? server.secret()
  const pending = server.beginAuthorization(validated, value, address)
  return consentPage(
    pending,
    await isTotpEnabled(),
    200,
    undefined,
    existing === undefined ? `${cookie.name}=${value}; ${cookie.attributes}` : undefined,
  )
}

/**
 * `POST /oauth/authorize`: the consent form. The form must come from this
 * origin (`Origin`, when the browser sends one), name a pending page, and carry
 * both that page's CSRF token and the browser's CSRF cookie. Deny sends the
 * client `access_denied`; approve signs in as the admin user first. A page
 * takes a few failed sign-ins and is then spent: the user starts again from
 * the app, which gives a guesser no endless retries on one page.
 */
export async function handleAuthorizePost(
  server: OAuthAuthorizationServer,
  request: Request,
  context: AuthorizeContext,
): Promise<Response> {
  const origin = request.headers.get('Origin')
  if (origin !== null && origin !== server.endpoints.issuer) return errorPage('forbidden', 403)
  const form = await readForm(request)
  if (isBodyProblem(form)) return errorPage('invalidRequest', 400)
  const pending = server.findPending(form.get('request_id') ?? '')
  if (pending === undefined) return errorPage('expired', 400)
  const cookie = browserCookie(request, csrfCookie(server))
  if (
    cookie === undefined ||
    !secretsEqual(cookie, pending.browserCookie) ||
    !secretsEqual(form.get('csrf') ?? '', pending.csrfToken)
  ) {
    return errorPage('forbidden', 403)
  }
  const { request: authorization } = pending
  const issuer = server.endpoints.issuer

  switch (form.get('action')) {
    case 'deny':
      server.endPending(pending.requestId)
      return clientRedirect(
        clientRedirectUrl(authorization.redirectUri, issuer, {
          error: 'access_denied',
          error_description: apiText('cli.mcp.oauth.error.authorize.accessDenied'),
          state: authorization.state,
        }),
      )
    case 'approve': {
      // Read before the check: if the credentials change while it runs, the
      // code carries the old fingerprint and is dead on arrival.
      const fingerprint = await server.currentFingerprint()
      if (fingerprint === undefined) return errorPage('unavailable', 503)
      const login = await verifyConsentLogin(
        {
          username: form.get('username') ?? '',
          password: form.get('password') ?? '',
          totpCode: (form.get('totp') ?? '').trim(),
        },
        { clientIp: context.clientIp, userAgent: context.userAgent },
        context.settings,
        { limiter: server.signInLimiter, gate: server.signInGate, totpBudget: server.totpBudget },
      )
      // The page may have expired, or been answered by another submission,
      // while this one was being checked: only one answer ever issues a code.
      if (server.findPending(pending.requestId) === undefined) return errorPage('expired', 400)
      if (!login.ok) {
        if (login.error === 'invalidCredentials') {
          pending.failures += 1
          if (pending.failures >= MAX_FAILED_ATTEMPTS_PER_PAGE) {
            server.endPending(pending.requestId)
            return errorPage('tooManyAttempts', 401)
          }
        }
        const status = login.error === 'invalidCredentials' ? 401 : 429
        const retryAfter =
          login.error === 'busy'
            ? BUSY_RETRY_AFTER_SECONDS
            : login.error === 'rateLimited'
              ? login.retryAfterSeconds
              : undefined
        return consentPage(
          pending,
          await isTotpEnabled(),
          status,
          login.error,
          undefined,
          retryAfter,
        )
      }
      server.endPending(pending.requestId)
      // An open page protects nothing: the client may have been evicted or
      // pruned while it was open, and then there is nothing to approve.
      if ((await server.findClient(authorization.clientId)) === undefined) {
        return errorPage('expired', 400)
      }
      const code = server.issueCode({ ...authorization, credentialFingerprint: fingerprint })
      return clientRedirect(
        clientRedirectUrl(authorization.redirectUri, issuer, { code, state: authorization.state }),
      )
    }
    default:
      return errorPage('invalidRequest', 400)
  }
}
