import type { Component, JSX } from 'solid-js'
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

// Component (not a plain function) so Solid establishes a rendering boundary per segment.
const InlineContent: Component<InlineProps> = (props) => {
  const parts: Array<JSX.Element | string> = []
  const tokenRe = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const pushText = (str: string) => {
    if (str) parts.push(str)
  }

  while ((match = tokenRe.exec(props.text)) !== null) {
    pushText(props.text.slice(lastIndex, match.index))
    const token = match[0]

    if (token.startsWith('[[youtube:')) {
      const videoId = token.slice('[[youtube:'.length, -2).trim()
      parts.push(
        <div class="primer-youtube">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}`}
            title="YouTube video"
            allowfullscreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>,
      )
    } else if (token.startsWith('[[')) {
      // Card link: [[Card Name]]
      const cardName = token.slice(2, -2).trim()
      const cardKey = Object.keys(props.cards).find(
        (k) => k.toLowerCase() === cardName.toLowerCase(),
      )
      // Resolve once here so both handlers share the same reference without
      // duplicating the expression.
      const resolvedName = cardKey ?? cardName
      parts.push(
        <span
          class={`primer-card-link ${cardKey ? 'primer-card-link--found' : 'primer-card-link--missing'}`}
          role="button"
          aria-label={`Open card: ${cardName}`}
          tabIndex={0}
          onClick={() => props.onOpenModal(resolvedName)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              props.onOpenModal(resolvedName)
            }
          }}
        >
          {cardName}
        </span>,
      )
    } else if (token.startsWith('**')) {
      parts.push(<strong>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      parts.push(<em>{token.slice(1, -1)}</em>)
    } else {
      pushText(token)
    }

    lastIndex = match.index + token.length
  }

  pushText(props.text.slice(lastIndex))
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

// Component (not a plain function) so Solid establishes a rendering boundary.
// Keys use the starting line index of each block for stable identity across edits.
const BlockContent: Component<BlockProps> = (props) => {
  const inlineProps = { cards: props.cards, onOpenModal: props.onOpenModal }
  const blocks: JSX.Element[] = []
  const lines = props.markdown.split('\n')
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
        <Tag id={id} class={`primer-heading primer-h${level}`}>
          <InlineContent text={text} {...inlineProps} />
        </Tag>,
      )
      i++
      continue
    }

    // Bullet list — collect consecutive list items
    if (line.match(/^[*-]\s+/)) {
      const items: JSX.Element[] = []
      while (i < lines.length && lines[i]!.match(/^[*-]\s+/)) {
        const itemText = lines[i]!.replace(/^[*-]\s+/, '')
        items.push(
          <li>
            <InlineContent text={itemText} {...inlineProps} />
          </li>,
        )
        i++
      }
      blocks.push(<ul class="primer-list">{items}</ul>)
      continue
    }

    // Paragraph — collect consecutive non-blank, non-heading, non-list lines
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
        <p class="primer-paragraph">
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

export const PrimerRenderer: Component<PrimerRendererProps> = (props) => {
  return (
    <div class="primer-content">
      <BlockContent
        markdown={props.primerMarkdown}
        cards={props.cards}
        onOpenModal={props.onOpenModal}
      />
    </div>
  )
}
