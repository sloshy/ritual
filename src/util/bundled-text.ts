/**
 * Shared helper for reading text assets embedded into the binary via Bun's
 * `import … with { type: 'text' }` syntax. Both the site SPA and the admin
 * SPA bundles use this.
 */

import { t } from '../i18n/t'
import { isRecord } from './json'

export function readTextModule(moduleValue: unknown, moduleName: string): string {
  const text = isRecord(moduleValue) ? moduleValue.default : undefined
  if (typeof text !== 'string') {
    throw new Error(t('errors.invariant.notTextModule', { module: moduleName }))
  }
  return text
}
