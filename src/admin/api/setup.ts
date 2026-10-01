import { createAdminUser, adminUserExists } from '../auth'
import { apiHandler } from '../utils'
import { apiMessage, type ApiMessage } from '../../api/result'
import { validateBodySize } from '../../api/http'
import { isRecord } from '../../util/json'
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
function parseSetupRequest(raw: unknown): SetupRequest | null {
  if (!isRecord(raw)) return null
  const { username, password, setupToken } = raw
  return {
    username: typeof username === 'string' ? username : '',
    password: typeof password === 'string' ? password : '',
    setupToken: typeof setupToken === 'string' ? setupToken : '',
  }
}

function refuse(status: number, reason: string | ApiMessage): Response {
  const resp: SetupResponse = {
    success: false,
    ...(typeof reason === 'string' ? { message: reason } : reason),
  }
  return Response.json(resp, { status })
}

export function handleSetup(req: Request): Promise<Response> {
  return apiHandler(async () => {
    if (await adminUserExists()) return refuse(409, 'Admin user already exists')

    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return refuse(400, 'Request body must be JSON.')
    }
    const body = parseSetupRequest(raw)
    if (!body) return refuse(400, 'Request body must be a JSON object.')

    // Before any field rule, so a caller without the token learns nothing about them.
    if (!isSetupToken(body.setupToken)) {
      return refuse(403, apiMessage('admin.api.setup.tokenInvalid'))
    }

    const { username, password } = body
    if (!username || !password) return refuse(400, 'username and password are required')
    if (username.length > MAX_USERNAME_LENGTH) return refuse(400, 'Username is too long')
    if (password.length > MAX_PASSWORD_LENGTH) return refuse(400, 'Password is too long')
    if (password.length < MIN_PASSWORD_LENGTH) {
      return refuse(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }

    await createAdminUser(username, password)
    const resp: SetupResponse = { success: true, message: 'Admin account created successfully' }
    return Response.json(resp)
  })
}
