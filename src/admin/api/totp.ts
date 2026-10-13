import { isTotpEnabled, getTotpSecret, setTotpSecret, getAdminUsername } from '../auth'
import { generateTotpSecret, verifyTotp, buildTotpUri } from '../totp'
import { apiHandler } from '../utils'
import { readJsonObjectBody } from '../../api/http'
import { apiMessage, type ApiMessage } from '../../api/result'

/** `POST /api/totp/setup`: the new secret and its URI, or the refusal. */
type TotpSetupResponse =
  { success: true; secret: string; uri: string } | (ApiMessage & { success: false })

export function handleTotpSetup(): Promise<Response> {
  return apiHandler(async () => {
    if (await isTotpEnabled()) {
      const resp: TotpSetupResponse = {
        success: false,
        ...apiMessage('admin.api.totp.alreadyEnabled'),
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

interface TotpVerifySetupResponse extends ApiMessage {
  success: boolean
}

export function handleTotpVerifySetup(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsed = await readJsonObjectBody(req)
    if (!parsed.ok) return parsed.response
    const code = typeof parsed.body.code === 'string' ? parsed.body.code : ''

    if (!code) {
      const resp: TotpVerifySetupResponse = {
        success: false,
        ...apiMessage('admin.api.totp.codeRequired'),
      }
      return Response.json(resp, { status: 400 })
    }

    const storedSecret = await getTotpSecret()
    if (!storedSecret || !storedSecret.startsWith('pending:')) {
      const resp: TotpVerifySetupResponse = {
        success: false,
        ...apiMessage('admin.api.totp.noPendingSetup'),
      }
      return Response.json(resp, { status: 400 })
    }

    const secret = storedSecret.slice('pending:'.length)
    const valid = await verifyTotp(secret, code)

    if (!valid) {
      const resp: TotpVerifySetupResponse = {
        success: false,
        ...apiMessage('admin.api.totp.codeInvalid'),
      }
      return Response.json(resp, { status: 400 })
    }

    // Activate TOTP by removing the pending: prefix
    await setTotpSecret(secret)
    const resp: TotpVerifySetupResponse = {
      success: true,
      ...apiMessage('admin.api.totp.enabled'),
    }
    return Response.json(resp)
  })
}

interface TotpDisableResponse extends ApiMessage {
  success: boolean
}

export function handleTotpDisable(): Promise<Response> {
  return apiHandler(async () => {
    if (!(await isTotpEnabled())) {
      const resp: TotpDisableResponse = {
        success: false,
        ...apiMessage('admin.api.totp.notEnabled'),
      }
      return Response.json(resp, { status: 400 })
    }

    await setTotpSecret(null)
    const resp: TotpDisableResponse = { success: true, ...apiMessage('admin.api.totp.disabled') }
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
