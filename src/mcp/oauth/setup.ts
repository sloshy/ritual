import { adminUserExists } from '../../admin/auth'
import { t } from '../../i18n/t'
import { ExitCode, type ExitCodeValue } from '../../util/errors'
import { COMMAND, CONFIG_KEY, commandLine } from '../../util/cli-tokens'
import { loadRitualConfig } from '../../config/ritual-config'
import { isLoopbackHost } from '../host'
import { isHttpsOrigin, type McpPublicUrl } from '../public-url'
import type { McpHttpAuth } from '../run'
import { isAcceptableIssuer } from './metadata'
import { describeOAuthStoreProblem } from '../../auth/mcp-oauth/state-message'
import { isOAuthStoreProblem, OAuthStore } from '../../auth/mcp-oauth/store'

/** The flags a refusal names, as the command spells them (`--oauth` or `--mcp-oauth`, …). */
export type OAuthFlagNames = {
  oauthFlag: string
  publicUrlFlag: string
}

/** What the OAuth endpoint will serve: where it is reached and bound, and any static token. */
export type OAuthServing = {
  publicUrl: McpPublicUrl | undefined
  /** The bind host. */
  host: string
  /** A static bearer token accepted beside OAuth access tokens, when one was given. */
  token: string | undefined
}

/** OAuth is ready to serve: the auth strategy to hand `runHttpServer`. */
export type OAuthReady = { ok: true; auth: McpHttpAuth }

/** OAuth cannot start: the refusal to print, and the exit code. */
export type OAuthRefusal = { ok: false; message: string; exitCode: ExitCodeValue }

function refuse(message: string, exitCode: ExitCodeValue): OAuthRefusal {
  return { ok: false, message, exitCode }
}

/**
 * Everything `--oauth` (`ritual mcp`) and `--mcp-oauth` (`ritual admin --mcp`)
 * check before a listener starts, in order: a public URL is given (usage
 * error); it is `https:`, or `http:` on a loopback host served from a loopback
 * bind (usage error); behind a proxy (a loopback bind, a non-loopback public
 * URL), `admin.trustProxy` is on (usage error); the admin account that signs
 * consents exists (not found); and the state file opens (runtime error). Returns the ready `oauth`
 * strategy, carrying the static token when one was given.
 */
export async function prepareMcpOAuth(
  serving: OAuthServing,
  flags: OAuthFlagNames,
): Promise<OAuthReady | OAuthRefusal> {
  const { publicUrl } = serving
  if (publicUrl === undefined) {
    return refuse(t('cli.mcp.oauth.publicUrlRequired', flags), ExitCode.UsageError)
  }
  if (!isAcceptableIssuer(publicUrl)) {
    return refuse(
      t('cli.mcp.oauth.httpsRequired', { ...flags, url: publicUrl.origin }),
      ExitCode.UsageError,
    )
  }
  // A loopback `http:` public URL is for testing on this machine; served from a
  // wider bind, it would put an unencrypted sign-in on the network.
  if (!isHttpsOrigin(publicUrl) && !isLoopbackHost(serving.host)) {
    return refuse(
      t('cli.mcp.oauth.httpNeedsLoopbackBind', {
        ...flags,
        url: publicUrl.origin,
        host: serving.host,
      }),
      ExitCode.UsageError,
    )
  }
  // A loopback bind reached at a non-loopback public URL has a tunnel or proxy
  // in front: unless its forwarded address is trusted, every client looks
  // like one address, and one shared bucket lets any stranger lock the owner out.
  if (
    isLoopbackHost(serving.host) &&
    !isLoopbackHost(publicUrl.hostname) &&
    !(await loadRitualConfig()).admin.trustProxy
  ) {
    return refuse(
      t('cli.mcp.oauth.trustProxyRequired', {
        oauthFlag: flags.oauthFlag,
        url: publicUrl.origin,
        configKey: CONFIG_KEY.adminTrustProxy,
        command: commandLine(COMMAND.configSet, CONFIG_KEY.adminTrustProxy, 'true'),
      }),
      ExitCode.UsageError,
    )
  }
  if (!(await adminUserExists())) {
    return refuse(
      t('cli.mcp.oauth.adminUserRequired', {
        oauthFlag: flags.oauthFlag,
        command: commandLine(COMMAND.adminSetup),
      }),
      ExitCode.NotFound,
    )
  }
  const store = await OAuthStore.open()
  if (isOAuthStoreProblem(store)) {
    return refuse(describeOAuthStoreProblem(store), ExitCode.RuntimeError)
  }
  const auth: McpHttpAuth =
    serving.token === undefined
      ? { kind: 'oauth', store }
      : { kind: 'oauth', store, token: serving.token }
  return { ok: true, auth }
}
