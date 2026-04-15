import { execSync } from 'node:child_process'
import { apiHandler } from '../utils'
import { getBaseDir } from '../../base-dir'

interface BuildSiteResponse {
  success: boolean
  message: string
}

export function handleBuildSite(): Promise<Response> {
  return apiHandler(async () => {
    execSync('bun run index.ts build-site', {
      cwd: getBaseDir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 300_000,
    })
    const resp: BuildSiteResponse = { success: true, message: 'Site built successfully' }
    return Response.json(resp)
  })
}
