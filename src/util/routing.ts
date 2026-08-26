export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * Match a route pattern against a concrete request path. Pattern segments
 * starting with `:` are parameters and match any single segment; a trailing `*`
 * segment matches the rest of the path (one segment or more), which is what
 * lets a route serve a nested file tree.
 */
export function matchRoute(routePath: string, requestPath: string): boolean {
  if (routePath === requestPath) return true
  const routeParts = routePath.split('/')
  const requestParts = requestPath.split('/')
  const matches = (part: string, i: number): boolean =>
    part.startsWith(':') || part === requestParts[i]
  if (routeParts[routeParts.length - 1] === '*') {
    const prefix = routeParts.slice(0, -1)
    return requestParts.length > prefix.length && prefix.every(matches)
  }
  if (routeParts.length !== requestParts.length) return false
  return routeParts.every(matches)
}
