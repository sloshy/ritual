export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * Match a route pattern against a concrete request path. Pattern segments
 * starting with `:` are parameters and match any single segment.
 */
export function matchRoute(routePath: string, requestPath: string): boolean {
  if (routePath === requestPath) return true
  const routeParts = routePath.split('/')
  const requestParts = requestPath.split('/')
  if (routeParts.length !== requestParts.length) return false
  return routeParts.every((part, i) => part.startsWith(':') || part === requestParts[i])
}
