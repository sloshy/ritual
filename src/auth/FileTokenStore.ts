import type { TokenStore } from './interfaces'
import fs from 'fs/promises'
import path from 'path'

export class FileTokenStore implements TokenStore {
  private getFilePath(site: string): string {
    const cwd = process.cwd()
    const loginDir = path.join(cwd, '.logins')
    return path.join(loginDir, `${site}.json`)
  }

  private async ensureDir(): Promise<void> {
    const cwd = process.cwd()
    const loginDir = path.join(cwd, '.logins')
    try {
      await fs.access(loginDir)
    } catch {
      await fs.mkdir(loginDir, { recursive: true, mode: 0o700 })
    }
  }

  async save(site: string, data: unknown): Promise<void> {
    await this.ensureDir()
    const filePath = this.getFilePath(site)
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), {
      mode: 0o600,
    })
  }

  async load<T>(site: string): Promise<T | null> {
    const filePath = this.getFilePath(site)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content) as T
    } catch (error) {
      return null
    }
  }

  async clear(site: string): Promise<void> {
    const filePath = this.getFilePath(site)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      // Ignore error if file doesn't exist
    }
  }
}
