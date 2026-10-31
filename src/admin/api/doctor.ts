import { collectDoctorReport } from '../../doctor/collect'
import type { DoctorReport } from '../../doctor/report'
import { apiHandler } from '../utils'

/** `GET /api/doctor` body: the report, flattened onto the success envelope. */
export type DoctorResponse = DoctorReport & { success: true }

/**
 * `GET /api/doctor` — the setup diagnostics `ritual doctor --output json`
 * prints: the running build, the workspace, its config and pending updates,
 * the card cache and the update check, each judged `ok`/`warn`/`fail`. A
 * failing check is still a 200 — the report is the answer; `ok` says whether
 * any check failed. Read-only and offline.
 */
export function handleDoctor(): Promise<Response> {
  return apiHandler(async () => {
    const resp: DoctorResponse = { success: true, ...(await collectDoctorReport()) }
    return Response.json(resp)
  })
}
