import type { Component } from 'solid-js'
import { createMemo, Show, For } from 'solid-js'
import type { ScryfallCard } from '../scryfall/types'
import { distinctCardFaces, type CardFace } from '../scryfall/card-utils'

type SymbolTextProps = {
  text: string
  symbolMap: Record<string, string>
}

export const SymbolText: Component<SymbolTextProps> = (props) => {
  const parts = createMemo(() => (props.text ? props.text.split(/(\{.*?\})/g) : []))
  return (
    <For each={parts()}>
      {(part) => (
        <Show when={props.symbolMap[part]} fallback={<>{part}</>}>
          {(src) => <img src={src()} alt={part} class="mana-symbol" />}
        </Show>
      )}
    </For>
  )
}

type ManaCostProps = {
  card: ScryfallCard
  isDFC: boolean
  symbolMap: Record<string, string>
}

/**
 * The faces a double-faced card's text renders, repeated faces dropped: a
 * reversible printing's two identical sides are one card's text, not two.
 */
function textFaces(props: Pick<ManaCostProps, 'card' | 'isDFC'>): CardFace[] | null {
  return props.isDFC && props.card.card_faces ? distinctCardFaces(props.card.card_faces) : null
}

export const ManaCost: Component<ManaCostProps> = (props) => {
  const costs = createMemo(
    () =>
      textFaces(props)
        ?.map((f) => f.mana_cost || '')
        .filter(Boolean) ?? null,
  )
  return (
    <Show
      when={costs()}
      fallback={<SymbolText text={props.card.mana_cost || ''} symbolMap={props.symbolMap} />}
    >
      {(c) => (
        <For each={c()}>
          {(cost, i) => (
            <>
              {i() > 0 && ' // '}
              <SymbolText text={cost} symbolMap={props.symbolMap} />
            </>
          )}
        </For>
      )}
    </Show>
  )
}

type OracleTextProps = {
  card: ScryfallCard
  isDFC: boolean
  symbolMap: Record<string, string>
}

export const OracleText: Component<OracleTextProps> = (props) => {
  return (
    <Show
      when={textFaces(props)}
      fallback={<SymbolText text={props.card.oracle_text || ''} symbolMap={props.symbolMap} />}
    >
      {(shown) => (
        <For each={shown()}>
          {(face, i) => (
            <>
              <Show when={i() > 0}>
                <hr class="dfc-separator" />
              </Show>
              <div>
                <strong>{face.name}</strong> <em>({face.type_line})</em>
              </div>
              <SymbolText text={face.oracle_text || ''} symbolMap={props.symbolMap} />
            </>
          )}
        </For>
      )}
    </Show>
  )
}
