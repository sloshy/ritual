import { isTotpEnabled, getTotpSecret, setTotpSecret, getAdminUsername } from '../auth'
import { generateTotpSecret, verifyTotp, buildTotpUri } from '../totp'
import { apiHandler } from '../utils'

interface TotpSetupResponse {
  success: boolean
  secret?: string
  uri?: string
  message?: string
}

export function handleTotpSetup(): Promise<Response> {
  return apiHandler(async () => {
    if (await isTotpEnabled()) {
      const resp: TotpSetupResponse = {
        success: false,
        message: 'TOTP is already enabled. Disable it first to reconfigure.',
      }
      return Response.json(resp, { status: 409 })
    }

    const secret = generateTotpSecret()
    const username = (await getAdminUsername()) ?? 'admin'
    const uri = buildTotpUri(secret, username)

    // Store secret provisionally — it becomes active only after verify-setup
    await setTotpSecret(`pending:${secret}`)

    const resp: TotpSetupResponse = { success: true, secret, uri }
    return Response.json(resp)
  })
}

interface TotpVerifySetupRequest {
  code: string
}

interface TotpVerifySetupResponse {
  success: boolean
  message: string
}

export function handleTotpVerifySetup(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = (await req.json()) as TotpVerifySetupRequest
    const { code } = body

    if (!code) {
      const resp: TotpVerifySetupResponse = { success: false, message: 'code is required' }
      return Response.json(resp, { status: 400 })
    }

    const storedSecret = await getTotpSecret()
    if (!storedSecret || !storedSecret.startsWith('pending:')) {
      const resp: TotpVerifySetupResponse = {
        success: false,
        message: 'No pending TOTP setup. Call /api/totp/setup first.',
      }
      return Response.json(resp, { status: 400 })
    }

    const secret = storedSecret.slice('pending:'.length)
    const valid = await verifyTotp(secret, code)

    if (!valid) {
      const resp: TotpVerifySetupResponse = {
        success: false,
        message: 'Invalid TOTP code. Check your authenticator app and try again.',
      }
      return Response.json(resp, { status: 400 })
    }

    // Activate TOTP by removing the pending: prefix
    await setTotpSecret(secret)
    const resp: TotpVerifySetupResponse = {
      success: true,
      message: 'TOTP enabled successfully',
    }
    return Response.json(resp)
  })
}

interface TotpDisableResponse {
  success: boolean
  message: string
}

export function handleTotpDisable(): Promise<Response> {
  return apiHandler(async () => {
    if (!(await isTotpEnabled())) {
      const resp: TotpDisableResponse = { success: false, message: 'TOTP is not enabled' }
      return Response.json(resp, { status: 400 })
    }

    await setTotpSecret(null)
    const resp: TotpDisableResponse = { success: true, message: 'TOTP disabled successfully' }
    return Response.json(resp)
  })
}

interface TotpStatusResponse {
  enabled: boolean
}

export async function handleTotpStatus(): Promise<Response> {
  const enabled = await isTotpEnabled()
  const resp: TotpStatusResponse = { enabled }
  return Response.json(resp)
}
