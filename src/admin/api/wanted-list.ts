import fs from 'node:fs/promises'
import path from 'node:path'
import { getWantedDir } from '../../ritual-config'

type WantedListItem = { slug: string; name: string }

interface WantedListsListResponse {
  wantedLists: WantedListItem[]
}

function parseTitleFromContent(content: string): string | null {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      return line.slice(2).trim()
    }
  }
  return null
}

export async function handleListWantedLists(): Promise<Response> {
  const wantedListsDir = getWantedDir()
  try {
    const files = await fs.readdir(wantedListsDir)
    const wantedListFiles = files.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
    const wantedLists = await Promise.all(
      wantedListFiles.map(async (f) => {
        const slug = f.replace(/\.md$/, '')
        try {
          const content = await fs.readFile(path.join(wantedListsDir, f), 'utf-8')
          const name = parseTitleFromContent(content) ?? slug
          return { slug, name }
        } catch {
          return { slug, name: slug }
        }
      }),
    )
    const body: WantedListsListResponse = { wantedLists }
    return Response.json(body)
  } catch {
    const body: WantedListsListResponse = { wantedLists: [] }
    return Response.json(body)
  }
}
