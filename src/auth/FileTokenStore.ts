import type { TokenStore } from './interfaces'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureLoginsDir, getLoginsDir } from '../logins-dir'

export class FileTokenStore implements TokenStore {
  private getFilePath(site: string): string {
    return path.join(getLoginsDir(), `${site}.json`)
  }

  async save(site: string, data: unknown): Promise<void> {
    await ensureLoginsDir()
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
    } catch {
      return null
    }
  }

  async clear(site: string): Promise<void> {
    const filePath = this.getFilePath(site)
    try {
      await fs.unlink(filePath)
    } catch {
      // Ignore error if file doesn't exist
    }
  }
}
