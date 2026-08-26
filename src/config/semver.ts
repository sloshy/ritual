type ParsedVersion = {
  major: number
  minor: number
  patch: number
  pre: string | null
}

function parseSemver(v: string): ParsedVersion {
  const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!match) {
    return { major: 0, minor: 0, patch: 0, pre: v }
  }
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
    pre: match[4] ?? null,
  }
}

type PreReleasePart = string | number

function parsePreRelease(pre: string): PreReleasePart[] {
  const parts: PreReleasePart[] = []
  const regex = /(\d+|[a-zA-Z]+)/g
  let match
  while ((match = regex.exec(pre)) !== null) {
    const part = match[1]!
    const n = parseInt(part, 10)
    parts.push(isNaN(n) ? part : n)
  }
  return parts
}

/**
 * Compare two semver strings. Returns negative if a < b, positive if a > b, 0 if equal.
 *
 * Pre-release versions (e.g. 1.0.0-beta5) sort lower than the corresponding release (1.0.0).
 * Pre-release identifiers are split into text and numeric parts and compared accordingly:
 *   1.0.0-beta1 < 1.0.0-beta5 < 1.0.0-rc1 < 1.0.0
 */
export function compareVersions(a: string, b: string): number {
  const va = parseSemver(a)
  const vb = parseSemver(b)

  if (va.major !== vb.major) return va.major - vb.major
  if (va.minor !== vb.minor) return va.minor - vb.minor
  if (va.patch !== vb.patch) return va.patch - vb.patch

  // Same X.Y.Z — compare pre-release
  if (va.pre === null && vb.pre === null) return 0
  if (va.pre === null) return 1 // release > pre-release
  if (vb.pre === null) return -1 // pre-release < release

  const pa = parsePreRelease(va.pre)
  const pb = parsePreRelease(vb.pre)

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const partA = pa[i]
    const partB = pb[i]

    if (partA === undefined) return -1
    if (partB === undefined) return 1

    if (typeof partA === 'number' && typeof partB === 'number') {
      if (partA !== partB) return partA - partB
    } else if (typeof partA === 'string' && typeof partB === 'string') {
      if (partA < partB) return -1
      if (partA > partB) return 1
    } else {
      // semver spec: numeric identifiers sort before string identifiers
      return typeof partA === 'number' ? -1 : 1
    }
  }

  return 0
}

/** Returns true if the string is a valid semver version (with optional leading `v`). */
export function isValidSemver(v: string): boolean {
  return /^v?\d+\.\d+\.\d+(?:-.+)?$/.test(v)
}
