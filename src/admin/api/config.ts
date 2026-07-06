import {
  getRitualConfigPath,
  loadRitualConfig,
  normalizeBannedPrintings,
  parseCacheLockTimeoutSeconds,
  parseDefaultCurrency,
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

    // Validate and normalize the default currency before persisting, matching
    // what config-set does — an unvalidated write here would otherwise persist
    // an invalid value that only gets caught (and silently reset to the
    // default) the next time the config is loaded, with no feedback to the caller.
    if (updates.defaultCurrency !== undefined) {
      const parsed = parseDefaultCurrency(updates.defaultCurrency)
      if (typeof parsed !== 'string') {
        return Response.json({ success: false, message: parsed.error }, { status: 400 })
      }
      updates.defaultCurrency = parsed
    }

    // Same rationale as defaultCurrency: reject an invalid lock timeout here
    // instead of persisting it and silently resetting on the next load.
    if (updates.cacheLockTimeoutSeconds !== undefined) {
      const parsed = parseCacheLockTimeoutSeconds(updates.cacheLockTimeoutSeconds)
      if (typeof parsed === 'string') {
        return Response.json({ success: false, message: parsed }, { status: 400 })
      }
      updates.cacheLockTimeoutSeconds = parsed
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
