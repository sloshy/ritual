import {
  getRitualConfigPath,
  loadRitualConfig,
  normalizeBannedPrintings,
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

    // Validate and normalize banned printings before persisting so the stored
    // config always holds canonical `set:collectorNumber` keys (set codes
    // lowercased), matching what config-set writes.
    if (updates.site?.bannedPrintings !== undefined) {
      const normalized = normalizeBannedPrintings(updates.site.bannedPrintings)
      if (typeof normalized === 'string') {
        return Response.json({ success: false, message: normalized }, { status: 400 })
      }
      updates.site = { ...updates.site, bannedPrintings: normalized }
    }

    const current = await loadRitualConfig()
    // `admin` is nested, so a partial update must merge into it rather than
    // replace it wholesale (the top-level spread would otherwise drop omitted
    // admin fields).
    const merged: RitualConfig = {
      ...current,
      ...updates,
      admin: updates.admin ? { ...current.admin, ...updates.admin } : current.admin,
    }
    await saveRitualConfig(merged)
    await reloadRitualConfig()

    if (shouldAutoCommit(merged, getBaseDir())) {
      commitFiles([getRitualConfigPath()], 'Update ritual configuration')
    }

    const resp: ConfigResponse = { success: true, config: merged }
    return Response.json(resp)
  })
}
