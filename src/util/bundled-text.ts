/**
 * Shared helper for reading text assets embedded into the binary via Bun's
 * `import … with { type: 'text' }` syntax. Both the site SPA and the admin
 * SPA bundles use this.
 */

type TextModule = { default?: unknown }

export function readTextModule(moduleValue: unknown, moduleName: string): string {
  const maybeDefaultExport = (moduleValue as TextModule).default
  if (typeof maybeDefaultExport !== 'string') {
    throw new Error(`Expected text module for ${moduleName}`)
  }
  return maybeDefaultExport
}
