import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../../base-dir'

type CollectionListItem = { slug: string; name: string }

interface CollectionsListResponse {
  collections: CollectionListItem[]
}

function parseTitleFromContent(content: string): string | null {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      return line.slice(2).trim()
    }
  }
  return null
}

export async function handleListCollections(): Promise<Response> {
  const collectionsDir = path.join(getBaseDir(), 'collections')
  try {
    const files = await fs.readdir(collectionsDir)
    const collectionFiles = files.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
    const collections = await Promise.all(
      collectionFiles.map(async (f) => {
        const slug = f.replace(/\.md$/, '')
        try {
          const content = await fs.readFile(path.join(collectionsDir, f), 'utf-8')
          const name = parseTitleFromContent(content) ?? slug
          return { slug, name }
        } catch {
          return { slug, name: slug }
        }
      }),
    )
    const body: CollectionsListResponse = { collections }
    return Response.json(body)
  } catch {
    const body: CollectionsListResponse = { collections: [] }
    return Response.json(body)
  }
}
