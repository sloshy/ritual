import path from 'node:path'

let baseDir: string = process.cwd()

export function getBaseDir(): string {
  return baseDir
}

export function setBaseDir(dir: string): void {
  baseDir = path.resolve(dir)
}
