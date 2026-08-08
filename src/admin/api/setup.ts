import { createAdminUser, adminUserExists } from '../auth'
import { apiHandler } from '../utils'
import type { ApiMessage } from './result'
import {
  MAX_BODY_SIZE,
  MAX_USERNAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../validation'

interface SetupRequest {
  username: string
  password: string
}

interface SetupResponse extends ApiMessage {
  success: boolean
}

export function handleSetup(req: Request): Promise<Response> {
  return apiHandler(async () => {
    if (await adminUserExists()) {
      const resp: SetupResponse = { success: false, message: 'Admin user already exists' }
      return Response.json(resp, { status: 409 })
    }

    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_SIZE) {
      const resp: SetupResponse = { success: false, message: 'Request body too large' }
      return Response.json(resp, { status: 413 })
    }

    const body = (await req.json()) as SetupRequest
    const { username, password } = body

    if (!username || !password) {
      const resp: SetupResponse = {
        success: false,
        message: 'username and password are required',
      }
      return Response.json(resp, { status: 400 })
    }

    if (username.length > MAX_USERNAME_LENGTH) {
      const resp: SetupResponse = { success: false, message: 'Username is too long' }
      return Response.json(resp, { status: 400 })
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      const resp: SetupResponse = { success: false, message: 'Password is too long' }
      return Response.json(resp, { status: 400 })
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      const resp: SetupResponse = {
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      }
      return Response.json(resp, { status: 400 })
    }

    await createAdminUser(username, password)
    const resp: SetupResponse = { success: true, message: 'Admin account created successfully' }
    return Response.json(resp)
  })
}
