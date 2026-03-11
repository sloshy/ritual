import { readAuditLog } from '../audit-log'

export async function handleGetAuditLog(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const limitStr = url.searchParams.get('limit')
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr) || 100, 1), 1000) : 100

  const entries = await readAuditLog(limit)
  return Response.json({ success: true, entries })
}
