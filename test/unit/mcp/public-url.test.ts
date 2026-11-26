import { describe, expect, test } from 'bun:test'
import { parseMcpPublicUrl, type McpPublicUrl } from '../../../src/mcp/public-url'
import { t } from '../../../src/i18n/t'
import { EXAMPLE } from '../../../src/util/cli-tokens'

type Accepted = { raw: string; expected: McpPublicUrl }
type Refused = { raw: string; message: string }

describe('parseMcpPublicUrl', () => {
  test('normalizes an http(s) origin to its origin and bare hostname', () => {
    const accepted: Accepted[] = [
      {
        raw: 'https://mcp.example.com',
        expected: { origin: 'https://mcp.example.com', hostname: 'mcp.example.com' },
      },
      // Trailing slash, upper case, the default port and surrounding blanks all fold away.
      {
        raw: '  HTTPS://MCP.Example.com:443/ ',
        expected: { origin: 'https://mcp.example.com', hostname: 'mcp.example.com' },
      },
      // A non-default port stays on the origin but never on the hostname,
      // which is what the SDK's Host/Origin allowlists compare.
      {
        raw: 'https://mcp.example.com:8443',
        expected: { origin: 'https://mcp.example.com:8443', hostname: 'mcp.example.com' },
      },
      {
        raw: 'http://10.0.0.5:8080/',
        expected: { origin: 'http://10.0.0.5:8080', hostname: '10.0.0.5' },
      },
      // IPv6 keeps its brackets, the SDK's allowlist spelling.
      {
        raw: 'https://[2001:db8::1]:8443',
        expected: { origin: 'https://[2001:db8::1]:8443', hostname: '[2001:db8::1]' },
      },
      // A fully qualified name's trailing dot is dropped from both, so the
      // allowlist entry equals the `Host` a tunnel sends; the port survives.
      {
        raw: 'https://mcp.example.com.',
        expected: { origin: 'https://mcp.example.com', hostname: 'mcp.example.com' },
      },
      {
        raw: 'https://mcp.example.com.:8443/',
        expected: { origin: 'https://mcp.example.com:8443', hostname: 'mcp.example.com' },
      },
      // An internationalized name is punycoded, the form a `Host` header carries.
      {
        raw: 'https://bücher.example',
        expected: { origin: 'https://xn--bcher-kva.example', hostname: 'xn--bcher-kva.example' },
      },
    ]
    for (const { raw, expected } of accepted) {
      expect({ raw, parsed: parseMcpPublicUrl(raw) }).toEqual({ raw, parsed: expected })
    }
  })

  test('refuses anything that is not a bare http(s) origin, each with its own reason', () => {
    const refused: Refused[] = [
      {
        raw: 'mcp.example.com',
        message: t('errors.mcp.publicUrl.invalid', {
          value: 'mcp.example.com',
          example: EXAMPLE.mcpPublicUrl,
        }),
      },
      {
        raw: '',
        message: t('errors.mcp.publicUrl.invalid', { value: '', example: EXAMPLE.mcpPublicUrl }),
      },
      // A refusal echoes the trimmed value, not the blanks around it.
      {
        raw: '  ftp://mcp.example.com  ',
        message: t('errors.mcp.publicUrl.scheme', { value: 'ftp://mcp.example.com' }),
      },
      {
        raw: 'https://./',
        message: t('errors.mcp.publicUrl.invalid', {
          value: 'https://./',
          example: EXAMPLE.mcpPublicUrl,
        }),
      },
      {
        raw: 'ftp://mcp.example.com',
        message: t('errors.mcp.publicUrl.scheme', { value: 'ftp://mcp.example.com' }),
      },
      // The credentials refusal takes no value, so the secret is never echoed.
      { raw: 'https://user:pass@mcp.example.com', message: t('errors.mcp.publicUrl.credentials') },
      { raw: 'https://user@mcp.example.com', message: t('errors.mcp.publicUrl.credentials') },
      // An empty user name or password is still userinfo.
      { raw: 'https://@mcp.example.com', message: t('errors.mcp.publicUrl.credentials') },
      { raw: 'https://:@mcp.example.com', message: t('errors.mcp.publicUrl.credentials') },
      ...[
        'https://mcp.example.com/mcp',
        'https://mcp.example.com/?a=1',
        'https://mcp.example.com/?',
        'https://mcp.example.com#frag',
        'https://mcp.example.com/#',
      ].map((raw) => ({
        raw,
        message: t('errors.mcp.publicUrl.notOrigin', { value: raw }),
      })),
    ]
    for (const { raw, message } of refused) {
      expect({ raw, parsed: parseMcpPublicUrl(raw) }).toEqual({ raw, parsed: message })
    }
  })

  test('never echoes a secret, whichever check the value would otherwise fail', () => {
    const secret = 's3cret'
    const leaky = [
      // A non-http(s) scheme would otherwise hit the scheme refusal, which echoes.
      `ftp://user:${secret}@mcp.example.com`,
      // Values `URL` cannot parse would otherwise hit the invalid refusal, which echoes.
      `https://user:${secret}@`,
      `https://user:${secret}@bad host`,
      // `URL` reads a special scheme's missing or backslashed slashes as `//`.
      `https:user:${secret}@mcp.example.com`,
      `https:\\\\user:${secret}@mcp.example.com`,
      // No scheme at all.
      `user:${secret}@mcp.example.com`,
      `${secret}@mcp.example.com`,
    ]
    for (const raw of leaky) {
      const parsed = parseMcpPublicUrl(raw)
      expect({ raw, parsed }).toEqual({ raw, parsed: t('errors.mcp.publicUrl.credentials') })
      expect(parsed).not.toContain(secret)
    }
  })
})
