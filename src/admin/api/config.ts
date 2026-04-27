import {
  getRitualConfigPath,
  loadRitualConfig,
  reloadRitualConfig,
  saveRitualConfig,
  type RitualConfig,
} from '../../ritual-config'
import { shouldAutoCommit, commitFiles } from '../git'
import { apiHandler } from '../utils'
import { MAX_BODY_SIZE } from '../validation'
import { getBaseDir } from '../../base-dir'

interface ConfigResponse {
  success: boolean
  config?: RitualConfig
  message?: string
}

export async function handleGetConfig(): Promise<Response> {
  const config = await loadRitualConfig()
  const resp: ConfigResponse = { success: true, config }
  return Response.json(resp)
}

export function handleUpdateConfig(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_SIZE) {
      return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
    }
    const updates = (await req.json()) as Partial<RitualConfig>
    const current = await loadRitualConfig()
    const merged: RitualConfig = { ...current, ...updates }
    await saveRitualConfig(merged)
    await reloadRitualConfig()

    if (shouldAutoCommit(merged, getBaseDir())) {
      commitFiles([getRitualConfigPath()], 'Update ritual configuration')
    }

    const resp: ConfigResponse = { success: true, config: merged }
    return Response.json(resp)
  })
}
