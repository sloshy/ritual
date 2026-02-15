import prompts from 'prompts'
import { ArchidektAuth } from './ArchidektAuth'

export async function promptForLogin(auth: ArchidektAuth): Promise<boolean> {
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
    console.log('Login cancelled')
    return false
  }

  try {
    await auth.login({
      username: response.username,
      password: response.password,
    })
    const user = await auth.getStoredUser()
    console.log(`Login successful! Logged in as ${user?.username}`)
    return true
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Login failed:', msg)
    return false
  }
}
