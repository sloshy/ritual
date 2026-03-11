import path from 'node:path'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { getErrorMessage } from '../../errors'

interface DeckCreateRequest {
  name: string
  format?: string
}

interface DeckCreateResponse {
  success: boolean
  message: string
  slug?: string
}

export async function handleDeckCreate(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as DeckCreateRequest
    const { name, format = 'commander' } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      const resp: DeckCreateResponse = { success: false, message: 'Deck name is required' }
      return Response.json(resp, { status: 400 })
    }

    const trimmedName = name.trim()
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    if (!slug) {
      const resp: DeckCreateResponse = {
        success: false,
        message: 'Deck name must contain at least one alphanumeric character',
      }
      return Response.json(resp, { status: 400 })
    }

    const decksDir = path.join(process.cwd(), 'decks')
    const filePath = path.join(decksDir, `${slug}.md`)

    if (await Bun.file(filePath).exists()) {
      const resp: DeckCreateResponse = {
        success: false,
        message: `A deck with slug '${slug}' already exists`,
      }
      return Response.json(resp, { status: 409 })
    }

    const content = `---
name: "${trimmedName}"
format: "${format}"
created: "${new Date().toISOString()}"
tags: []
---

# ${trimmedName}

// Add your cards here
`

    await Bun.write(filePath, content)

    const config = await loadConfig()
    if (shouldAutoCommit(config, decksDir)) {
      commitFiles([filePath], `Create deck: ${trimmedName}`)
      if (shouldAutoPush(config, decksDir)) {
        pushChanges(decksDir)
      }
    }

    const resp: DeckCreateResponse = {
      success: true,
      message: `Created deck '${trimmedName}'`,
      slug,
    }
    return Response.json(resp)
  } catch (error) {
    const resp: DeckCreateResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}
