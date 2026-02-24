import type { FunctionalComponent } from 'preact'
import { Layout } from './Layout'
import { CardItem } from './CardItem'
import type { DeckData, ScryfallCard } from '../types'

interface DeckPageProps {
  deck: DeckData
  cards: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
  exportPath?: string
  useScryfallImgUrls?: boolean
}

export const DeckPage: FunctionalComponent<DeckPageProps> = ({
  deck,
  cards,
  symbolMap,
  exportPath,
  useScryfallImgUrls,
}) => {
  const replaceSymbols = (text: string) => {
    if (!text) return text
    const parts = text.split(/(\{.*?\})/g)
    return parts.map((part, i) => {
      if (symbolMap[part]) {
        return (
          <img
            key={i}
            src={symbolMap[part]}
            alt={part}
            className="inline-block h-4 w-4 mx-0.5 align-middle"
          />
        )
      }
      return part
    })
  }

  return (
    <Layout title={deck.name}>
      <div className="container mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{deck.name}</h1>
            {deck.sourceUrl && (
              <a
                href={deck.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-gray-400 hover:text-white"
              >
                Imported from{' '}
                {(() => {
                  if (deck.sourceUrl.includes('moxfield.com')) return 'Moxfield'
                  if (deck.sourceUrl.includes('archidekt.com')) return 'Archidekt'
                  if (deck.sourceUrl.includes('mtggoldfish.com')) return 'MTGGoldfish'
                  return 'Source'
                })()}{' '}
                ↗
              </a>
            )}
          </div>
          {exportPath && (
            <div className="flex gap-2">
              <a
                href={exportPath}
                download={`${deck.name.replace(/[^a-zA-Z0-9]/g, '_')}.txt`}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-semibold transition-colors"
              >
                Download
              </a>
              <button
                data-copy-src={exportPath}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition-colors cursor-pointer"
                id="btn-copy-deck"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap gap-3 items-center text-xs">
          <div className="view-toggle" id="view-toggle">
            <button data-view="binder" className="active" title="Binder View">
              ▦
            </button>
            <button data-view="list" title="List View">
              ☰
            </button>
            <button data-view="overlap" title="Overlapping View">
              ⧗
            </button>
            <button data-view="stack" title="Column Stack View">
              ▥
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-gray-500">Group:</label>
            <select
              id="sort-group"
              className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none"
            >
              <option value="type">Type</option>
              <option value="section">Section</option>
              <option value="cmc">Mana Value</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-gray-500">Sort:</label>
            <select
              id="sort-by"
              className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none"
            >
              <option value="name">Name</option>
              <option value="cmc">Mana Value</option>
              <option value="price">Price</option>
              <option value="edhrec">EDHRec Rank</option>
            </select>
          </div>
          <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
            <input type="checkbox" id="sort-reverse" className="rounded" />
            Reverse
          </label>
          <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
            <input type="checkbox" id="filter-lands" className="rounded" />
            Hide Lands
          </label>
          <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
            <input type="checkbox" id="show-extras" className="rounded" />
            Extras
          </label>
        </div>

        <script src="deck-sort.js" defer />
        <script src="copy-button.js" defer />

        {/* Description / Primer */}
        {(deck.description || deck.primer) && (
          <div className="mb-6">
            {deck.description && (
              <div className="mb-4 text-sm text-gray-300">
                {deck.description.length > 200 ? (
                  <div>
                    <input type="checkbox" id="desc-expand" className="peer hidden" />
                    <div className="peer-checked:hidden whitespace-pre-wrap">
                      {replaceSymbols(deck.description.slice(0, 200))}…
                    </div>
                    <div className="hidden peer-checked:block whitespace-pre-wrap">
                      {replaceSymbols(deck.description)}
                    </div>
                    <label
                      htmlFor="desc-expand"
                      className="text-blue-400 cursor-pointer text-xs hover:underline peer-checked:hidden"
                    >
                      Read more
                    </label>
                    <label
                      htmlFor="desc-expand"
                      className="text-blue-400 cursor-pointer text-xs hover:underline hidden peer-checked:inline"
                    >
                      Show less
                    </label>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{replaceSymbols(deck.description)}</div>
                )}
              </div>
            )}
            {deck.primer && (
              <div className="text-sm text-gray-300">
                {deck.primer.length > 200 ? (
                  <div>
                    <input type="checkbox" id="primer-expand" className="peer hidden" />
                    <div className="peer-checked:hidden whitespace-pre-wrap">
                      {replaceSymbols(deck.primer.slice(0, 200))}…
                    </div>
                    <div className="hidden peer-checked:block whitespace-pre-wrap">
                      {replaceSymbols(deck.primer)}
                    </div>
                    <label
                      htmlFor="primer-expand"
                      className="text-blue-400 cursor-pointer text-xs hover:underline peer-checked:hidden"
                    >
                      Read more
                    </label>
                    <label
                      htmlFor="primer-expand"
                      className="text-blue-400 cursor-pointer text-xs hover:underline hidden peer-checked:inline"
                    >
                      Show less
                    </label>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{replaceSymbols(deck.primer)}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Card sections — binder grid */}
        <div className="space-y-6">
          {deck.sections.map((section) => {
            if (section.cards.length === 0) return null
            return (
              <div key={section.name} data-section={section.name}>
                <div className="section-divider" id={section.name.replace(/[^a-zA-Z0-9]/g, '_')}>
                  <h2>
                    <a
                      href={`#${section.name.replace(/[^a-zA-Z0-9]/g, '_')}`}
                      className="hover:underline"
                    >
                      {section.name}
                    </a>
                  </h2>
                  <span className="section-count">
                    {section.cards.reduce((sum, c) => sum + c.quantity, 0)}
                  </span>
                </div>
                <div className="binder-grid">
                  {section.cards.map((card) => (
                    <CardItem
                      key={card.name}
                      name={card.name}
                      quantity={card.quantity}
                      card={cards[card.name] || null}
                      symbolMap={symbolMap}
                      hideCount={section.name.toLowerCase().includes('commander')}
                      useScryfallImgUrls={useScryfallImgUrls}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Modal container — populated by card-modal.js */}
        <div id="card-modal-root" className="card-modal-backdrop" role="dialog" aria-modal="true">
          <div className="card-modal" style="position:relative;">
            <button className="modal-close" aria-label="Close">
              &times;
            </button>
            <div className="card-modal-image">
              <img id="modal-img-front" src="" alt="" />
              <img id="modal-img-back" src="" alt="" className="hidden" />
              <button id="modal-flip-btn" className="flip-btn hidden">
                Flip ↻
              </button>
            </div>
            <div className="card-modal-details">
              <div className="modal-card-name" id="modal-name" />
              <div className="modal-type-line" id="modal-type" />
              <div className="modal-mana-cost" id="modal-mana" />
              <div className="modal-oracle-text" id="modal-oracle" />
              <div className="modal-meta" id="modal-meta" />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
