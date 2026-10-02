/**
 * Where Ritual's releases live and what their binaries are called — the one
 * owner of facts that `.github/workflows/build-binaries.yml` builds,
 * `release.yml` publishes, and both `self-update` and the generated deploy
 * workflow download. Dependency-free so any layer can read it.
 */

/** The repository releases are published from. */
export const GITHUB_REPO = 'sloshy/ritual'

/** The releases API root for {@link GITHUB_REPO}. */
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}`

/** The repository's web address, where its source lives. */
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`

/** The prefix a release asset's download URL starts with: `<prefix>/<tag>/<asset>`. */
export const GITHUB_RELEASES_DOWNLOAD = `${GITHUB_REPO_URL}/releases/download`

/** Release asset names by `process.platform`, then `process.arch`. */
type ReleaseAssetTable = Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>>

/**
 * The release assets (see `.github/workflows/build-binaries.yml`, whose
 * matrices test/unit/release-contract.test.ts holds to this table). Literal,
 * so a named entry such as {@link DEPLOY_WORKFLOW_ASSET} cannot go missing.
 */
const RELEASE_ASSETS = {
  linux: { x64: 'ritual-linux-x86_64', arm64: 'ritual-linux-arm64' },
  darwin: { x64: 'ritual-macos-x86_64', arm64: 'ritual-macos-arm64' },
  win32: { x64: 'ritual-windows-x86_64.exe', arm64: 'ritual-windows-arm64.exe' },
} as const satisfies ReleaseAssetTable

/** Every release asset name, in table order. */
export const RELEASE_ASSET_NAMES: readonly string[] = Object.values(RELEASE_ASSETS).flatMap(
  (byArch) => Object.values(byArch),
)

/** The asset the generated publish-for-me deploy workflow downloads (GitHub's ubuntu-latest). */
export const DEPLOY_WORKFLOW_ASSET = RELEASE_ASSETS.linux.x64

/** The release asset built for a platform, or `undefined` when Ritual ships none. */
export function assetNameFor(platform: NodeJS.Platform, arch: string): string | undefined {
  const table: ReleaseAssetTable = RELEASE_ASSETS
  return table[platform]?.[arch]
}
