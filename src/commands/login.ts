import { Command } from 'commander'

import { ArchidektAuth } from '../auth/ArchidektAuth'
import { FileTokenStore } from '../auth/FileTokenStore'

export function registerLoginCommand(program: Command) {
  const loginCommand = program.command('login').description('Login to a supported website')

  loginCommand
    .command('archidekt')
    .description('Login to Archidekt')
    .option('-f, --force-login', 'Force a new login even if a session exists')
    .action(async (options) => {
      const tokenStore = new FileTokenStore()
      const auth = new ArchidektAuth(tokenStore)

      if (!options.forceLogin) {
        try {
          const user = await auth.getStoredUser()
          if (user) {
            const token = await auth.getToken()
            if (token) {
              console.log(`Logged in as ${user.username}`)
              return
            }
            console.log(`Session for ${user.username} expired.`)
          }
        } catch (e) {
          // Ignore errors during check, proceed to login
        }
      }

      const { promptForLogin } = await import('../auth/login-helper')
      await promptForLogin(auth)
    })
}
