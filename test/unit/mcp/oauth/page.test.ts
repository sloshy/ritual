import { describe, expect, test } from 'bun:test'
import {
  pageContentSecurityPolicy,
  renderConsentPage,
  renderErrorPage,
} from '../../../../src/mcp/oauth/page'

const HOSTILE = `"><script>alert('x')</script><img src=x onerror=alert(1)>`

describe('renderConsentPage', () => {
  test('escapes every client-supplied value it shows', () => {
    const html = renderConsentPage({
      clientName: HOSTILE,
      redirectHost: `evil.example"><script>alert(2)</script>`,
      requestId: `id"><script>`,
      csrfToken: 'csrf',
      totpEnabled: false,
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;')
    expect(html).toContain('value="id&quot;&gt;&lt;script&gt;"')
  })

  test('names an unnamed client generically and shows the redirect host', () => {
    const html = renderConsentPage({
      redirectHost: 'claude.ai',
      requestId: 'r',
      csrfToken: 'c',
      totpEnabled: true,
      error: 'invalidCredentials',
    })
    expect(html).toContain('An unnamed app')
    expect(html).toContain('<code>claude.ai</code>')
    expect(html).toMatch(/name="totp"[^>]* required/)
    expect(html).toContain('role="alert"')
  })

  test('asks for a TOTP code only when two-factor sign-in is on, and carries no script', () => {
    const html = renderConsentPage({
      redirectHost: 'h',
      requestId: 'r',
      csrfToken: 'c',
      totpEnabled: false,
    })
    expect(html).not.toContain('name="totp"')
    expect(html).not.toMatch(/<script|\son\w+=/i)
  })
})

describe('renderErrorPage', () => {
  test('has no form, so there is nothing to submit from an untrusted request', () => {
    const html = renderErrorPage('invalidRequest')
    expect(html).not.toContain('<form')
    expect(html).toContain('This sign-in cannot continue')
  })
})

describe('pageContentSecurityPolicy', () => {
  test('forbids scripts and framing, and admits the client origin as a form target', () => {
    const csp = pageContentSecurityPolicy('https://claude.ai')
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self' https://claude.ai")
    expect(csp).not.toContain('script-src')
    expect(csp).not.toContain('unsafe-inline')
  })
})

describe('the IPv6 loopback form target', () => {
  test('is admitted by scheme, since Chromium ignores an IPv6 host source', () => {
    expect(pageContentSecurityPolicy('http://[::1]:4567')).toContain("form-action 'self' http:;")
    expect(pageContentSecurityPolicy('http://localhost:4567')).toContain(
      "form-action 'self' http://localhost:4567;",
    )
  })
})
