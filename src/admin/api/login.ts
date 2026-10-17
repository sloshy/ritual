import { badRequest, errorResponse, nestedRefusal, readJsonObjectBody } from '../../api/http'
import { ArchidektAuth, ArchidektAuthError, isCredentialRefusal } from '../../auth/ArchidektAuth'
import { FileTokenStore } from '../../auth/FileTokenStore'
import { apiMessage, type ApiMessage } from '../../api/result'

/** A successful login: who is now signed in. Every refusal is the shared error body. */
interface ArchidektLoginResponse extends ApiMessage {
  success: true
  username: string
}

/**
 * The status a failed Archidekt request answers with: `401` when Archidekt
 * refused the credentials (a 4xx other than a rate limit), `502` when it failed
 * some other way (a 5xx, a 429, a reply without a usable session).
 */
function upstreamFailureStatus(error: ArchidektAuthError): number {
  return isCredentialRefusal(error.upstreamStatus) ? 401 : 502
}

export async function handleArchidektLogin(req: Request): Promise<Response> {
  try {
    const parsed = await readJsonObjectBody(req)
    if (!parsed.ok) return parsed.response
    const username = typeof parsed.body.username === 'string' ? parsed.body.username : ''
    const password = typeof parsed.body.password === 'string' ? parsed.body.password : ''

    if (!username || !password) {
      return badRequest(apiMessage('admin.api.field.credentialsRequired'))
    }

    const tokenStore = new FileTokenStore()
    const auth = new ArchidektAuth(tokenStore)

    await auth.login({ username, password })
    const signedIn = (await auth.getStoredUser())?.username ?? username

    const resp: ArchidektLoginResponse = {
      success: true,
      ...apiMessage('admin.api.archidekt.loggedIn', { username: signedIn }),
      username: signedIn,
    }
    return Response.json(resp)
  } catch (error) {
    // Archidekt's refusal (`domain.sync.auth.*`) goes out in English beside its
    // key, for the client to word in its reader's language. Anything else — a
    // token file that could not be written, a reply that was not JSON — is a
    // failure of this server, answered like any other route's.
    if (error instanceof ArchidektAuthError) {
      return nestedRefusal(error.syncMessage, upstreamFailureStatus(error))
    }
    return errorResponse(error)
  }
}

export async function handleArchidektStatus(): Promise<Response> {
  const tokenStore = new FileTokenStore()
  const auth = new ArchidektAuth(tokenStore)
  const status = await auth.getStatus()
  return Response.json(status)
}
