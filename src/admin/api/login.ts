import { ArchidektAuth } from '../../auth/ArchidektAuth'
import { FileTokenStore } from '../../auth/FileTokenStore'
import { getErrorMessage } from '../../errors'

interface ArchidektLoginRequest {
  username: string
  password: string
}

interface ArchidektLoginResponse {
  success: boolean
  message: string
  username?: string
}

export async function handleArchidektLogin(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as ArchidektLoginRequest
    const { username, password } = body

    if (!username || !password) {
      const resp: ArchidektLoginResponse = {
        success: false,
        message: 'username and password are required',
      }
      return Response.json(resp, { status: 400 })
    }

    const tokenStore = new FileTokenStore()
    const auth = new ArchidektAuth(tokenStore)

    await auth.login({ username, password })
    const user = await auth.getStoredUser()

    const resp: ArchidektLoginResponse = {
      success: true,
      message: `Logged in as ${user?.username ?? username}`,
      username: user?.username ?? username,
    }
    return Response.json(resp)
  } catch (error) {
    const msg = getErrorMessage(error)
    const resp: ArchidektLoginResponse = { success: false, message: msg }
    return Response.json(resp, { status: 401 })
  }
}
