import { Fragment } from 'preact'
import type { FunctionalComponent } from 'preact'
import type { ScryfallCard } from '../types'

type SymbolTextProps = {
  text: string
  symbolMap: Record<string, string>
}

export const SymbolText: FunctionalComponent<SymbolTextProps> = ({ text, symbolMap }) => {
  if (!text) return null
  const parts = text.split(/(\{.*?\})/g)
  return (
    <>
      {parts.map((part, i) => {
        if (symbolMap[part]) {
          return <img key={i} src={symbolMap[part]} alt={part} className="mana-symbol" />
        }
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}

type ManaCostProps = {
  card: ScryfallCard
  isDFC: boolean
  symbolMap: Record<string, string>
}

export const ManaCost: FunctionalComponent<ManaCostProps> = ({ card, isDFC, symbolMap }) => {
  if (isDFC && card.card_faces) {
    const costs = card.card_faces.map((f) => f.mana_cost || '').filter(Boolean)
    return (
      <>
        {costs.map((cost, i) => (
          <Fragment key={i}>
            {i > 0 && ' // '}
            <SymbolText text={cost} symbolMap={symbolMap} />
          </Fragment>
        ))}
      </>
    )
  }
  return <SymbolText text={card.mana_cost || ''} symbolMap={symbolMap} />
}

type OracleTextProps = {
  card: ScryfallCard
  isDFC: boolean
  symbolMap: Record<string, string>
}

export const OracleText: FunctionalComponent<OracleTextProps> = ({ card, isDFC, symbolMap }) => {
  if (isDFC && card.card_faces) {
    return (
      <>
        {card.card_faces.map((face, i) => (
          <Fragment key={i}>
            {i > 0 && <hr className="my-2 border-gray-600" />}
            <div>
              <strong>{face.name}</strong> <em>({face.type_line})</em>
            </div>
            <SymbolText text={face.oracle_text || ''} symbolMap={symbolMap} />
          </Fragment>
        ))}
      </>
    )
  }
  return <SymbolText text={card.oracle_text || ''} symbolMap={symbolMap} />
}
