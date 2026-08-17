import { describe, test, expect } from 'bun:test'
import { parseArtRequestPath } from '../../../src/api/art'

/**
 * `GET /art/*`'s path parser — the half of the art route that decides whether a
 * request can name a file at all, before any directory is consulted.
 *
 * It is the first of two guards (`isPathWithinDir` is the second), and the only
 * one that sees the request's *encoded* spelling: once a segment is decoded, a
 * `%2F` and a real separator are indistinguishable, so a traversal that survives
 * this function is a traversal the path check has to catch by luck. Every
 * rejection below is therefore a case where the decoded value could name
 * something outside the art directory, or nothing at all.
 *
 * The route's file side effects — real bytes, real content types, a real file
 * planted outside the art directory — are pinned in
 * test/integration/site-server.test.ts.
 */

type PathCase = { label: string; pathname: string; expected: string | null }

const cases: PathCase[] = [
  {
    label: 'a nested path is the art-dir-relative path, percent-decoded',
    pathname: '/art/proxies/sol%20ring.png',
    expected: 'proxies/sol ring.png',
  },
  {
    label: 'a single segment needs no directory',
    pathname: '/art/bolt.png',
    expected: 'bolt.png',
  },
  {
    label: 'a path outside the route prefix is not ours',
    pathname: '/assets/bolt.png',
    expected: null,
  },
  {
    label: 'the bare prefix names no file',
    pathname: '/art/',
    expected: null,
  },
  {
    label: 'an empty segment (a doubled slash) is refused, not collapsed',
    pathname: '/art/proxies//bolt.png',
    expected: null,
  },
  {
    label: 'a trailing slash names a directory, not an image',
    pathname: '/art/proxies/',
    expected: null,
  },
  {
    label: 'a malformed percent escape is refused rather than passed through raw',
    pathname: '/art/%zz.png',
    expected: null,
  },
  {
    label: 'a literal "." segment is refused',
    pathname: '/art/./bolt.png',
    expected: null,
  },
  {
    label: 'an encoded "." segment is refused after decoding too',
    pathname: '/art/%2E/bolt.png',
    expected: null,
  },
  {
    label: 'a literal ".." segment is refused',
    pathname: '/art/../ritual.config.json',
    expected: null,
  },
  {
    label: 'an encoded ".." segment is refused after decoding too',
    pathname: '/art/%2E%2E/bolt.png',
    expected: null,
  },
  {
    label: 'a decoded forward slash cannot smuggle a second segment in',
    pathname: '/art/..%2F..%2Fritual.config.json',
    expected: null,
  },
  {
    label: 'a decoded backslash cannot smuggle a Windows separator in',
    pathname: '/art/..%5Csecrets.png',
    expected: null,
  },
  {
    label: 'a decoded NUL cannot truncate the path a syscall sees',
    pathname: '/art/bolt.png%00.txt',
    expected: null,
  },
]

describe('parseArtRequestPath', () => {
  for (const { label, pathname, expected } of cases) {
    test(label, () => {
      expect(parseArtRequestPath(pathname)).toBe(expected)
    })
  }
})
