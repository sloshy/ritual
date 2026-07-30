import { access } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { inputRequiredError, promptsUnavailable } from './no-input'

/** Returns true if the path exists and is accessible. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/** Render a millisecond duration as e.g. "2 days, 3 hours" or "45 minutes". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return 'less than a minute'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  // Only bother with minute precision when the total is under a day.
  if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  return parts.join(', ')
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Walk a pre-split dotted path (e.g. `['admin', 'gitEnabled']`) into a nested
 * object. Returns undefined as soon as a segment is missing or a non-object is
 * reached.
 */
export function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export async function promptUser(question: string): Promise<string> {
  // The same structured usage error `ask()` throws, so a prompt that cannot run
  // exits 2 whichever helper asked for the input (`src/errors.ts` is a leaf, so
  // there is no cycle to route around here).
  if (promptsUnavailable()) throw inputRequiredError(question.trim())
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
