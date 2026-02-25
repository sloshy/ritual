import type { FunctionalComponent } from 'preact'
import type { DeckSummary } from './data-types'

interface IndexPageProps {
  decks: DeckSummary[]
  useScryfallImgUrls: boolean
}

export const IndexPage: FunctionalComponent<IndexPageProps> = ({ decks }) => {
  return (
    <div className="container mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-white">My Decks</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {decks.map((deck) => {
          const link = `#/deck/${deck.slug}`

          return (
            <a href={link} key={deck.slug} className="block">
              <div className="deck-cover">
                <div className="cover-image">
                  {deck.featuredCardImage ? (
                    <img src={deck.featuredCardImage} alt={deck.name} />
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                      No Image
                    </div>
                  )}
                  <div className="cover-overlay" />
                  <div className="cover-info">
                    <h2>{deck.name}</h2>
                    {deck.commander && (
                      <p className="cover-subtitle">Commander: {deck.commander}</p>
                    )}
                  </div>
                </div>
                <div className="cover-cardcount">{deck.cardCount} cards</div>
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
