import path from 'node:path'
import { getContentHash } from '../../content-hash'
import { parseWantedListFile } from '../../commands/wanted-helpers'
import { getErrorMessage } from '../../errors'
import { isPathWithinDir } from '../../path-validation'
import { getBaseDir } from '../../base-dir'
import { addChangelogCardNames, fetchSymbolMap, loadEntryCardData } from './card-data-loader'

export async function handleWantedListLoad(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const rawSlug = pathParts[3]

    if (!rawSlug) {
      return Response.json(
        { success: false, message: 'Wanted list slug is required' },
        { status: 400 },
      )
    }

    const slug = decodeURIComponent(rawSlug)
    const wantedListsDir = path.join(getBaseDir(), 'wanted')
    const filePath = path.join(wantedListsDir, slug + '.md')
    if (!isPathWithinDir(filePath, wantedListsDir)) {
      return Response.json({ success: false, message: 'Invalid wanted list slug' }, { status: 400 })
    }
    const file = Bun.file(filePath)

    if (!(await file.exists())) {
      return Response.json(
        { success: false, message: `Wanted list '${slug}' not found` },
        { status: 404 },
      )
    }

    const content = await file.text()
    const { entries } = parseWantedListFile(content)

    // Collect unique card names
    const cardNames = new Set<string>()
    for (const entry of entries) {
      cardNames.add(entry.name)
    }

    await addChangelogCardNames(filePath, cardNames)

    const { cards, printings } = await loadEntryCardData(cardNames)
    const symbolMap = await fetchSymbolMap()

    const contentHash = await getContentHash(filePath, content)

    return Response.json({
      success: true,
      entries,
      cards,
      printings,
      symbolMap,
      slug,
      contentHash,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
