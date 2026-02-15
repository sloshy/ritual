import type { FunctionalComponent } from 'preact'
import { Layout } from './Layout'
import type { DeckData, ScryfallCard } from '../types'

interface IndexPageProps {
  decks: {
    data: DeckData
    featuredCard: ScryfallCard | null
  }[]
}

export const IndexPage: FunctionalComponent<IndexPageProps> = ({ decks }) => {
  return (
    <Layout title="My Decks">
      <div className="container mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center text-transparent bg-clip-text bg-linear-to-r from-purple-400 to-pink-600">
          My Magic Decks
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {decks.map(({ data, featuredCard }) => {
            const safeName = data.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '')
            const link = `${safeName}.html`
            const imagePath = featuredCard ? `images/${featuredCard.id}.jpg` : null

            return (
              <a href={link} key={data.name} className="block group">
                <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-purple-500 transition-all transform hover:-translate-y-1 hover:shadow-2xl">
                  <div className="h-48 bg-gray-900 relative overflow-hidden">
                    {imagePath ? (
                      <img
                        src={imagePath}
                        alt={data.name}
                        className="w-full h-full object-cover object-[50%_25%] group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-700">
                        No Image
                      </div>
                    )}
                    <div className="absolute inset-0 bg-linear-to-t from-gray-900 to-transparent opacity-80" />
                    <div className="absolute bottom-4 left-4">
                      <h2 className="text-xl font-bold text-white group-hover:text-purple-300">
                        {data.name}
                      </h2>
                      {featuredCard && (
                        <p className="text-xs text-gray-400">Commander: {featuredCard.name}</p>
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="text-gray-400 text-sm">
                      {data.sections.reduce((acc, s) => acc + s.cards.length, 0)} Cards
                    </p>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      </div>
    </Layout>
  )
}
