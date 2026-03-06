import type { FunctionalComponent, VNode } from 'preact'
import type { ScryfallCard } from '../types'
import type { PrimerHeading } from '../primer-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrimerRendererProps = {
  primerMarkdown: string
  cards: Record<string, ScryfallCard | null>
  onOpenModal: (cardName: string) => void
}

// ---------------------------------------------------------------------------
// Heading ID generation (must match primer-parser.ts logic)
// ---------------------------------------------------------------------------

function headingId(text: string): string {
  return text
    .replace(/\*+/g, '')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ---------------------------------------------------------------------------
// TOC extraction
// ---------------------------------------------------------------------------

export function buildToc(markdown: string): PrimerHeading[] {
  const headings: PrimerHeading[] = []
  for (const line of markdown.split('\n')) {
    const m = line.match(/^(#{2,6})\s+(.+)$/)
    if (m) {
      const level = m[1]!.length
      const text = m[2]!.trim()
      headings.push({ id: headingId(text), text, level })
    }
  }
  return headings
}

// ---------------------------------------------------------------------------
// Inline content renderer
//
// Handles: **bold**, *italic*, [[youtube:id]] embeds, [[Card Name]] links,
// and plain text — all within a single line of text.
// ---------------------------------------------------------------------------

type InlineProps = {
  text: string
  cards: Record<string, ScryfallCard | null>
  onOpenModal: (cardName: string) => void
}

// InlineContent is a proper Preact component rather than a plain helper function so
// that Preact establishes a component boundary for each inline segment.  This lets
// the reconciler diff at the component level and makes the tree easier to optimise
// (e.g. wrap with memo) in the future.
const InlineContent: FunctionalComponent<InlineProps> = ({ text, cards, onOpenModal }) => {
  const parts: Array<VNode | string> = []
  const tokenRe = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const pushText = (str: string) => {
    if (str) parts.push(str)
  }

  while ((match = tokenRe.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index))
    const token = match[0]!

    if (token.startsWith('[[youtube:')) {
      const videoId = token.slice('[[youtube:'.length, -2).trim()
      parts.push(
        <div key={`yt-${videoId}-${match.index}`} className="primer-youtube">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}`}
            title="YouTube video"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>,
      )
    } else if (token.startsWith('[[')) {
      // Card link: [[Card Name]]
      const cardName = token.slice(2, -2).trim()
      const cardKey = Object.keys(cards).find((k) => k.toLowerCase() === cardName.toLowerCase())
      // Resolve once here so both handlers share the same reference without
      // duplicating the expression.
      const resolvedName = cardKey ?? cardName
      parts.push(
        <span
          key={`card-${cardName}-${match.index}`}
          className={`primer-card-link ${cardKey ? 'primer-card-link--found' : 'primer-card-link--missing'}`}
          role="button"
          aria-label={`Open card: ${cardName}`}
          tabIndex={0}
          onClick={() => onOpenModal(resolvedName)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenModal(resolvedName)
            }
          }}
        >
          {cardName}
        </span>,
      )
    } else if (token.startsWith('**')) {
      parts.push(<strong key={`b-${match.index}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      parts.push(<em key={`i-${match.index}`}>{token.slice(1, -1)}</em>)
    } else {
      pushText(token)
    }

    lastIndex = match.index + token.length
  }

  pushText(text.slice(lastIndex))
  return <>{parts}</>
}

// ---------------------------------------------------------------------------
// Block-level renderer
//
// Processes the Markdown into blocks: headings, bullet lists, and paragraphs.
// ---------------------------------------------------------------------------

type BlockProps = {
  markdown: string
  cards: Record<string, ScryfallCard | null>
  onOpenModal: (cardName: string) => void
}

// BlockContent is a proper Preact component (returning a Fragment) rather than a
// plain helper function so that Preact establishes a component boundary for the
// entire block tree — enabling proper reconciliation and future memoisation.
//
// Keys are derived from the *starting line index* of each block (`h${level}-${i}`,
// `ul-${listStartI}`, `p-${paraStartI}`).  This is more stable than a sequential
// counter: if blocks are added/removed earlier in the document the unchanged blocks
// at their original line positions keep their keys and are not needlessly remounted.
const BlockContent: FunctionalComponent<BlockProps> = ({ markdown, cards, onOpenModal }) => {
  const inlineProps = { cards, onOpenModal }
  const blocks: VNode[] = []
  const lines = markdown.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Blank line — skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      const text = headingMatch[2]!.trim()
      const id = headingId(text)
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(
        <Tag key={`h${level}-${i}`} id={id} className={`primer-heading primer-h${level}`}>
          <InlineContent text={text} {...inlineProps} />
        </Tag>,
      )
      i++
      continue
    }

    // Bullet list — collect consecutive list items
    if (line.match(/^[*-]\s+/)) {
      const listStartI = i
      const items: VNode[] = []
      while (i < lines.length && lines[i]!.match(/^[*-]\s+/)) {
        const itemText = lines[i]!.replace(/^[*-]\s+/, '')
        items.push(
          <li key={`li-${i}`}>
            <InlineContent text={itemText} {...inlineProps} />
          </li>,
        )
        i++
      }
      blocks.push(
        <ul key={`ul-${listStartI}`} className="primer-list">
          {items}
        </ul>,
      )
      continue
    }

    // Paragraph — collect consecutive non-blank, non-heading, non-list lines
    const paraStartI = i
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.match(/^#{2,6}\s/) &&
      !lines[i]!.match(/^[*-]\s+/)
    ) {
      paraLines.push(lines[i]!)
      i++
    }

    if (paraLines.length > 0) {
      // Join lines and render inline
      const paraText = paraLines.join(' ')
      blocks.push(
        <p key={`p-${paraStartI}`} className="primer-paragraph">
          <InlineContent text={paraText} {...inlineProps} />
        </p>,
      )
    }
  }

  return <>{blocks}</>
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const PrimerRenderer: FunctionalComponent<PrimerRendererProps> = ({
  primerMarkdown,
  cards,
  onOpenModal,
}) => {
  return (
    <div className="primer-content">
      <BlockContent markdown={primerMarkdown} cards={cards} onOpenModal={onOpenModal} />
    </div>
  )
}
