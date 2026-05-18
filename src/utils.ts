import { createInterface } from 'node:readline/promises'

// Sanitize a deck name for use as a filename by removing characters that are
// problematic on common file systems, while preserving case and spacing.
export function sanitizeDeckFileName(name: string): string {
  return (
    name
      .trim()
      // eslint-disable-next-line no-control-regex -- null byte is intentional: strips filename-illegal chars.
      .replace(/[/\\:*?"<>|\x00]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .trim()
  )
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export async function promptUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}
