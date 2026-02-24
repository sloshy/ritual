import type { FunctionalComponent } from 'preact'
import { Layout } from './Layout'
import type { DeckData, ScryfallCard } from '../types'
import { resolveCardImageSources } from './image-sources'

interface IndexPageProps {
  decks: {
    data: DeckData
    featuredCard: ScryfallCard | null
  }[]
  useScryfallImgUrls?: boolean
}

export const IndexPage: FunctionalComponent<IndexPageProps> = ({ decks, useScryfallImgUrls }) => {
  return (
    <Layout title="My Decks">
      <div className="container mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-white">My Decks</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map(({ data, featuredCard }) => {
            const safeName = data.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '')
            const link = `${safeName}.html`
            const imagePath = featuredCard
              ? resolveCardImageSources(featuredCard, Boolean(useScryfallImgUrls)).frontImage
              : null
            const cardCount = data.sections.reduce((acc, s) => acc + s.cards.length, 0)

            return (
              <a href={link} key={data.name} className="block">
                <div className="deck-cover">
                  <div className="cover-image">
                    {imagePath ? (
                      <img src={imagePath} alt={data.name} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                        No Image
                      </div>
                    )}
                    <div className="cover-overlay" />
                    <div className="cover-info">
                      <h2>{data.name}</h2>
                      {featuredCard && (
                        <p className="cover-subtitle">Commander: {featuredCard.name}</p>
                      )}
                    </div>
                  </div>
                  <div className="cover-cardcount">{cardCount} cards</div>
                </div>
              </a>
            )
          })}
        </div>
      </div>
    </Layout>
  )
}
