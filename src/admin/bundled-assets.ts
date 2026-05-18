import * as adminStylesTextModule from './site/styles.compiled.css' with { type: 'text' }
import * as adminAppJsTextModule from './site/app.compiled.js' with { type: 'text' }
import { readTextModule } from '../bundled-text'

export function getBundledAdminCss(): string {
  return readTextModule(adminStylesTextModule, 'admin/styles.css')
}

export function getBundledAdminJs(): string {
  return readTextModule(adminAppJsTextModule, 'admin/app.js')
}
