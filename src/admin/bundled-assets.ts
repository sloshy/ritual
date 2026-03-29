import * as adminStylesTextModule from './site/styles.compiled.css' with { type: 'text' }

function readTextModule(moduleValue: unknown, moduleName: string): string {
  const maybeDefaultExport = (moduleValue as { default?: unknown }).default
  if (typeof maybeDefaultExport !== 'string') {
    throw new Error(`Expected text module for ${moduleName}`)
  }
  return maybeDefaultExport
}

export function getBundledAdminCss(): string {
  return readTextModule(adminStylesTextModule, 'admin/styles.css')
}
