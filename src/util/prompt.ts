import { createInterface } from 'node:readline/promises'
import { inputRequiredError, promptsUnavailable } from './no-input'

export async function promptUser(question: string): Promise<string> {
  // The same structured usage error `ask()` throws, so a prompt that cannot run
  // exits 2 whichever helper asked for the input (`src/util/errors.ts` is a leaf, so
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
