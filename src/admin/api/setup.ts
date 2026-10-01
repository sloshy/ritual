import { createAdminUser, adminUserExists } from '../auth'
import { apiHandler } from '../utils'
import { apiMessage, type ApiMessage } from '../../api/result'
import { apiError, readJsonObjectBody } from '../../api/http'
import { isSetupToken } from '../setup-token'
import { MAX_USERNAME_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../validation'

interface SetupRequest {
  username: string
  password: string
  /** The one-time token `ritual admin` printed (`src/admin/setup-token.ts`). */
  setupToken: string
}

interface SetupResponse extends ApiMessage {
  success: boolean
}

/**
 * Read a setup body. Every field is checked to be a string here, so the
 * length rules below measure text — a numeric `password` would otherwise pass
 * them (`undefined > 64` is false) and reach the hasher. An empty field reads
 * as missing; the caller reports that.
 */
function parseSetupRequest(raw: Record<string, unknown>): SetupRequest {
  const { username, password, setupToken } = raw
  return {
    username: typeof username === 'string' ? username : '',
    password: typeof password === 'string' ? password : '',
    setupToken: typeof setupToken === 'string' ? setupToken : '',
  }
}

export function handleSetup(req: Request): Promise<Response> {
  return apiHandler(async () => {
    if (await adminUserExists()) return apiError('Admin user already exists', 409)

    const parsed = await readJsonObjectBody(req)
    if (!parsed.ok) return parsed.response
    const body = parseSetupRequest(parsed.body)

    // Before any field rule, so a caller without the token learns nothing about them.
    if (!isSetupToken(body.setupToken)) {
      return apiError(apiMessage('admin.api.setup.tokenInvalid'), 403)
    }

    const { username, password } = body
    if (!username || !password) return apiError('username and password are required', 400)
    if (username.length > MAX_USERNAME_LENGTH) return apiError('Username is too long', 400)
    if (password.length > MAX_PASSWORD_LENGTH) return apiError('Password is too long', 400)
    if (password.length < MIN_PASSWORD_LENGTH) {
      return apiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400)
    }

    await createAdminUser(username, password)
    const resp: SetupResponse = { success: true, message: 'Admin account created successfully' }
    return Response.json(resp)
  })
}
