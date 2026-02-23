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
    // ... (existing replaceSymbols logic)
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
        <div className="mb-8 border-b border-gray-700 pb-4 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{deck.name}</h1>
            {deck.sourceUrl && (
              <a
                href={deck.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-400 hover:underline block"
              >
                Deck imported from{' '}
                {(() => {
                  if (deck.sourceUrl.includes('moxfield.com')) return 'Moxfield'
                  if (deck.sourceUrl.includes('archidekt.com')) return 'Archidekt'
                  if (deck.sourceUrl.includes('mtggoldfish.com')) return 'MTGGoldfish'
                  return 'Source'
                })()}
              </a>
            )}
          </div>
          {exportPath && (
            <div className="flex gap-2">
              <a
                href={exportPath}
                download={`${deck.name.replace(/[^a-zA-Z0-9]/g, '_')}.txt`}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-semibold transition-colors flex items-center gap-2"
              >
                <span>Download Text</span>
              </a>
              <button
                data-copy-src={exportPath}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-semibold transition-colors flex items-center gap-2 cursor-pointer"
                id="btn-copy-deck"
              >
                <span>Copy Text</span>
              </button>
            </div>
          )}
        </div>

        {/* Sorting Toolbar */}
        <div className="mb-6 p-4 bg-gray-800 rounded border border-gray-700 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Group By:</label>
              <select
                id="sort-group"
                className="bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-blue-500 outline-none"
              >
                <option value="type">Type</option>
                <option value="section">Section</option>
                <option value="cmc">Mana Value</option>
                <option value="none">None (Full Deck)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Sort By:</label>
              <select
                id="sort-by"
                className="bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-blue-500 outline-none"
              >
                <option value="name">Name</option>
                <option value="cmc">Mana Value</option>
                <option value="price">Price</option>
                <option value="edhrec">EDHRec Rank</option>
              </select>
            </div>
          </div>
          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                id="sort-reverse"
                className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
              />
              Reverse
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                id="filter-lands"
                className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
              />
              Hide Lands
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                id="show-extras"
                className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
              />
              Show Extras
            </label>
          </div>
        </div>

        <script src="deck-sort.js" defer />

        <script src="copy-button.js" defer />

        {(deck.description || deck.primer) && (
          <div className="mb-8 grid grid-cols-1 gap-6">
            {/* ... Description/Primer ... */}
            {deck.description && (
              <div className="bg-gray-800 p-6 rounded border border-gray-700">
                <h2 className="text-xl font-bold text-white mb-4">Description</h2>
                {deck.description.length > 250 ? (
                  <div className="group">
                    <input type="checkbox" id="desc-expand" className="peer hidden" />
                    <div className="peer-checked:hidden text-gray-300 whitespace-pre-wrap">
                      {replaceSymbols(deck.description.slice(0, 250))}...
                    </div>
                    <div className="hidden peer-checked:block text-gray-300 whitespace-pre-wrap">
                      {replaceSymbols(deck.description)}
                    </div>
                    <label
                      htmlFor="desc-expand"
                      className="text-blue-400 cursor-pointer block mt-2 hover:underline peer-checked:hidden"
                    >
                      Source: Read More
                    </label>
                    <label
                      htmlFor="desc-expand"
                      className="text-blue-400 cursor-pointer hidden mt-2 hover:underline peer-checked:block"
                    >
                      Show Less
                    </label>
                  </div>
                ) : (
                  <div className="text-gray-300 whitespace-pre-wrap">
                    {replaceSymbols(deck.description)}
                  </div>
                )}
              </div>
            )}

            {deck.primer && (
              <div className="bg-gray-800 p-6 rounded border border-gray-700">
                <h2 className="text-xl font-bold text-white mb-4">Primer</h2>
                {deck.primer.length > 250 ? (
                  <div className="group">
                    <input type="checkbox" id="primer-expand" className="peer hidden" />
                    <div className="peer-checked:hidden text-gray-300 whitespace-pre-wrap">
                      {replaceSymbols(deck.primer.slice(0, 250))}...
                    </div>
                    <div className="hidden peer-checked:block text-gray-300 whitespace-pre-wrap">
                      {replaceSymbols(deck.primer)}
                    </div>
                    <label
                      htmlFor="primer-expand"
                      className="text-blue-400 cursor-pointer block mt-2 hover:underline peer-checked:hidden"
                    >
                      Read More
                    </label>
                    <label
                      htmlFor="primer-expand"
                      className="text-blue-400 cursor-pointer hidden mt-2 hover:underline peer-checked:block"
                    >
                      Show Less
                    </label>
                  </div>
                ) : (
                  <div className="text-gray-300 whitespace-pre-wrap">
                    {replaceSymbols(deck.primer)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-8">
          {/* ... Sections ... */}
          {deck.sections.map((section) => {
            if (section.cards.length === 0) return null
            return (
              <div key={section.name} data-section={section.name}>
                <h2
                  id={section.name.replace(/[^a-zA-Z0-9]/g, '_')}
                  className="text-xl font-semibold mb-4 text-purple-400 border-l-4 border-purple-500 pl-3 scroll-mt-20"
                >
                  <a
                    href={`#${section.name.replace(/[^a-zA-Z0-9]/g, '_')}`}
                    className="hover:underline"
                  >
                    {section.name}
                  </a>{' '}
                  <span className="text-gray-500 text-sm font-normal ml-2">
                    ({section.cards.reduce((sum, c) => sum + c.quantity, 0)})
                  </span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
      </div>
    </Layout>
  )
}
