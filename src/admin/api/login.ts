import { ArchidektAuth } from '../../auth/ArchidektAuth'
import { FileTokenStore } from '../../auth/FileTokenStore'
import { getErrorMessage } from '../../util/errors'
import { apiMessage, type ApiMessage } from '../../api/result'

interface ArchidektLoginRequest {
  username: string
  password: string
}

interface ArchidektLoginResponse extends ApiMessage {
  success: boolean
  username?: string
}

export async function handleArchidektLogin(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as ArchidektLoginRequest
    const { username, password } = body

    if (!username || !password) {
      const resp: ArchidektLoginResponse = {
        success: false,
        ...apiMessage('admin.api.archidekt.credentialsRequired'),
      }
      return Response.json(resp, { status: 400 })
    }

    const tokenStore = new FileTokenStore()
    const auth = new ArchidektAuth(tokenStore)

    await auth.login({ username, password })
    const user = await auth.getStoredUser()

    const resp: ArchidektLoginResponse = {
      success: true,
      ...apiMessage('admin.api.archidekt.loggedIn', { username: user?.username ?? username }),
      username: user?.username ?? username,
    }
    return Response.json(resp)
  } catch (error) {
    const msg = getErrorMessage(error)
    const resp: ArchidektLoginResponse = { success: false, message: msg }
    return Response.json(resp, { status: 401 })
  }
}

export async function handleArchidektStatus(): Promise<Response> {
  const tokenStore = new FileTokenStore()
  const auth = new ArchidektAuth(tokenStore)
  const status = await auth.getStatus()
  return Response.json(status)
}
