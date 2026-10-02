/**
 * The Fan Content Policy notice lives in five formats (plain text, two
 * Markdowns, Astro, and a translatable catalog entry), so it cannot be shared
 * code. Each copy is held here to the sentences the policy requires.
 */
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { sitePagesMessages } from '../../src/i18n/messages/en/site-pages'

const ROOT = path.resolve(import.meta.dir, '../..')
const POLICY_URL = 'https://company.wizards.com/en/legal/fancontentpolicy'
const REQUIRED = [
  'unofficial Fan Content permitted under the',
  'Not approved or endorsed by Wizards of the Coast.',
  'Portions of the materials used are property of Wizards of the Coast.',
  '©Wizards of the Coast LLC.',
]

/** A file's text with markup and line wrapping reduced to single spaces. */
function prose(relative: string): string {
  return fs
    .readFileSync(path.join(ROOT, relative), 'utf8')
    .replace(/<[^>]+>|\{' '\}/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\(https?:[^)]+\)/g, '')
    .replace(/\s+/g, ' ')
}

describe('the Fan Content Policy notice', () => {
  test.each([
    'NOTICE',
    'README.md',
    'docs-site/src/content/docs/attribution.md',
    'docs-site/src/components/Footer.astro',
  ])('%s carries every required sentence and links the policy', (file) => {
    const text = prose(file)
    for (const sentence of REQUIRED) expect(text).toContain(sentence)
    expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).toContain(POLICY_URL)
  })

  test("the public site's footer message carries them too", () => {
    const message = sitePagesMessages['site.app.fanContent'].replace(
      '{policy}',
      'Fan Content Policy',
    )
    for (const sentence of REQUIRED) expect(message).toContain(sentence)
  })
})
