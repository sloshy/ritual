import { afterEach, describe, expect, test } from 'bun:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { initI18n, resetUiLocaleResolution } from '../../../src/cli/locale'
import { ENV_VAR } from '../../../src/util/cli-tokens'
import { en } from '../../../src/i18n/messages/en'
import { loadDictionary, resetI18nRuntime } from '../../../src/i18n/runtime'
import { t } from '../../../src/i18n/t'
import { buildMcpServer } from '../../../src/mcp/server'
import { toToolErrorPayload } from '../../../src/mcp/result'
import { CacheLockTimeoutError } from '../../../src/cache/lock'
import { pseudoCatalog, withSyntheticLocale } from '../../helpers/sync-text'
import { PSEUDO_LOCALE } from '../../../scripts/generate-locales'

/**
 * MCP prose is **English by contract**: tool names, titles,
 * descriptions, `.describe()` parameter docs, output-schema descriptions, the
 * server `instructions`, and resource-template metadata never follow the user's
 * UI locale. They are model-facing prose interleaved with flags, paths, and
 * `snake_case` tool names — a translated copy would help no one and would move
 * identifiers clients match on.
 *
 * The registration path calls no `t()`, so this is a *guard*, not a
 * description of a mechanism: it fails the moment a catalog lookup is
 * introduced there. The pseudo-locale is what makes it able to fail — every
 * catalog string changes under it, so a leak is unmissable. (What `src/mcp/`
 * does translate is addressed to people, not the model: the operator's console
 * lines and the elicitation forms a client shows its user — pinned in
 * `removal-elicitation.test.ts`.)
 *
 * Wiring only, per the MCP testing policy: what the tools *do* is covered by
 * the handler and engine suites.
 */

/** Everything a client can read as prose from a freshly built server. */
type ProseSnapshot = {
  /** `instructions` from the initialize result. */
  instructions: string | undefined
  /** `tools/list` verbatim — names, titles, descriptions, and both schemas. */
  tools: string
  /** `resources/templates/list` verbatim — the template's title and description. */
  resourceTemplates: string
}

/**
 * Connect a client to a *newly built* server and read back everything it
 * advertises. Built fresh each time on purpose: Commander-style registration
 * evaluates its strings once, so a locale read at registration would only show
 * up in a server constructed after the switch.
 */
async function captureProse(): Promise<ProseSnapshot> {
  const client = new Client({ name: 'ritual-locale-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([buildMcpServer().connect(serverTransport), client.connect(clientTransport)])
  try {
    const { tools } = await client.listTools()
    const { resourceTemplates } = await client.listResourceTemplates()
    return {
      instructions: client.getInstructions(),
      tools: JSON.stringify(tools),
      resourceTemplates: JSON.stringify(resourceTemplates),
    }
  } finally {
    await client.close()
  }
}

describe('MCP prose is English whatever the UI locale', () => {
  afterEach(() => {
    resetI18nRuntime()
    resetUiLocaleResolution()
  })

  test('RITUAL_LOCALE=en-XA changes no tool name, description, schema, or instruction', async () => {
    const english = await captureProse()
    // The instructions are a cross-tool contract an agent reads on every
    // session; an empty one would make the comparison below vacuous.
    expect(english.instructions).toContain('Ritual manages')

    loadDictionary(PSEUDO_LOCALE, pseudoCatalog())
    const resolution = initI18n({
      argv: ['bun', 'ritual', 'mcp'],
      env: { [ENV_VAR.locale]: PSEUDO_LOCALE },
      platform: 'linux',
    })
    // The locale really is in force — otherwise this test would pass on a
    // server that *does* translate its prose.
    expect(resolution.locale).toBe(PSEUDO_LOCALE)
    expect(resolution.source).toBe('env')
    expect(t('help.locale.summary')).not.toBe(en['help.locale.summary'])

    expect(await captureProse()).toEqual(english)
  })

  test('a keyed engine error thrown in a tool body reaches the client in English', () => {
    // A cache-lock time-out raised under the server's own (non-English) UI
    // language: its Error.message is that language, the tool error is not.
    const payload = withSyntheticLocale('xx', { 'domain.cache.lockTimedOut': 'ZEIT UM' }, () => {
      const thrown = new CacheLockTimeoutError(null, 5 * 60_000)
      expect(thrown.message).toBe('ZEIT UM')
      return toToolErrorPayload(thrown)
    })
    expect(payload).toEqual({
      error: true,
      code: 'internal',
      message:
        'Timed out after 5 minutes waiting for the cache lock held by another process. If no other ritual process is running, delete the lock file manually.',
    })
  })
})
