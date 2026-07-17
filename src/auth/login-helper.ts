import prompts from 'prompts'
import { ArchidektAuth } from './ArchidektAuth'
import { getErrorMessage } from '../errors'

export type LoginPromptOutcome = 'success' | 'cancelled' | 'failed'

export async function promptForLoginOutcome(auth: ArchidektAuth): Promise<LoginPromptOutcome> {
  const response = await prompts([
    {
      type: 'text',
      name: 'username',
      message: 'Username or Email',
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password',
    },
  ])

  if (!response.username || !response.password) {
    console.error('Cancelled.')
    return 'cancelled'
  }

  try {
    await auth.login({
      username: response.username,
      password: response.password,
    })
    const user = await auth.getStoredUser()
    console.log(`Login successful! Logged in as ${user?.username}`)
    return 'success'
  } catch (error: unknown) {
    const msg = getErrorMessage(error)
    console.error('Login failed:', msg)
    return 'failed'
  }
}
