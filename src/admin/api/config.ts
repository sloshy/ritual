import { loadConfig, saveConfig, type AdminConfig } from '../config'
import { shouldAutoCommit, commitFiles } from '../git'
import { apiHandler } from '../utils'
import path from 'node:path'

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
    const updates = (await req.json()) as Partial<AdminConfig>
    const current = await loadConfig()
    const merged: AdminConfig = { ...current, ...updates }
    await saveConfig(merged)

    const configPath = path.join(process.cwd(), 'ritual.config.json')
    if (shouldAutoCommit(merged, process.cwd())) {
      commitFiles([configPath], 'Update ritual configuration')
    }

    const resp: ConfigResponse = { success: true, config: merged }
    return Response.json(resp)
  })
}
