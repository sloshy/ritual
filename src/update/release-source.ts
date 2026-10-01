/**
 * Where Ritual's releases live and what their binaries are called — the one
 * owner of facts that `.github/workflows/release-binaries.yml` publishes and
 * both `self-update` and the generated deploy workflow download. Dependency-free
 * so any layer can read it.
 */

/** The repository releases are published from. */
export const GITHUB_REPO = 'sloshy/ritual'

/** The releases API root for {@link GITHUB_REPO}. */
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}`

/** The prefix a release asset's download URL starts with: `<prefix>/<tag>/<asset>`. */
export const GITHUB_RELEASES_DOWNLOAD = `https://github.com/${GITHUB_REPO}/releases/download`

/** Release asset names by `process.platform`, then `process.arch` (see `release-binaries.yml`). */
const RELEASE_ASSETS: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> = {
  linux: { x64: 'ritual-linux-x86_64', arm64: 'ritual-linux-arm64' },
  darwin: { x64: 'ritual-macos-x86_64', arm64: 'ritual-macos-arm64' },
  win32: { x64: 'ritual-windows-x86_64.exe', arm64: 'ritual-windows-arm64.exe' },
}

/** The release asset built for a platform, or `undefined` when Ritual ships none. */
export function assetNameFor(platform: NodeJS.Platform, arch: string): string | undefined {
  return RELEASE_ASSETS[platform]?.[arch]
}
