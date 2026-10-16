/**
 * Driving the admin config route (`PUT /api/config`) in-process, the way the
 * admin Settings page and the MCP `update_config` tool reach it.
 */

import { handleUpdateConfig } from '../../src/admin/api/config'

/** `PUT /api/config` with `config` as the body: the partial config object itself. */
export function putConfig(config: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(config)
  return handleUpdateConfig(
    new Request('http://admin/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      body,
    }),
  )
}
