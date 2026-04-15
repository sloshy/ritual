import { loadConfig, saveConfig, type AdminConfig } from '../config'
import { shouldAutoCommit, commitFiles } from '../git'
import { apiHandler } from '../utils'
import path from 'node:path'
import { MAX_BODY_SIZE } from '../validation'
import { getBaseDir } from '../../base-dir'

interface ConfigResponse {
  success: boolean
  config?: AdminConfig
  message?: string
}

export async function handleGetConfig(): Promise<Response> {
  const config = await loadConfig()
  const resp: ConfigResponse = { success: true, config }
  return Response.json(resp)
}

export function handleUpdateConfig(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_SIZE) {
      return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
    }
    const updates = (await req.json()) as Partial<AdminConfig>
    const current = await loadConfig()
    const merged: AdminConfig = { ...current, ...updates }
    await saveConfig(merged)

    const configPath = path.join(getBaseDir(), 'ritual.config.json')
    if (shouldAutoCommit(merged, getBaseDir())) {
      commitFiles([configPath], 'Update ritual configuration')
    }

    const resp: ConfigResponse = { success: true, config: merged }
    return Response.json(resp)
  })
}
