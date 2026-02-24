// Card detail modal — opens on card click, shows image + details
// Also handles list-view hover tooltip
document.addEventListener('DOMContentLoaded', () => {
  const backdrop = document.getElementById('card-modal-root')
  if (!backdrop) return

  const imgFront = document.getElementById('modal-img-front') as HTMLImageElement
  const imgBack = document.getElementById('modal-img-back') as HTMLImageElement
  const flipBtn = document.getElementById('modal-flip-btn') as HTMLButtonElement
  const nameEl = document.getElementById('modal-name') as HTMLElement
  const typeEl = document.getElementById('modal-type') as HTMLElement
  const manaEl = document.getElementById('modal-mana') as HTMLElement
  const oracleEl = document.getElementById('modal-oracle') as HTMLElement
  const metaEl = document.getElementById('modal-meta') as HTMLElement
  const closeBtn = backdrop.querySelector('.modal-close') as HTMLElement

  let showingBack = false

  const openModal = (cardItem: HTMLElement) => {
    const name = cardItem.getAttribute('data-modal-name') || ''
    const type = cardItem.getAttribute('data-modal-type') || ''
    const front = cardItem.getAttribute('data-modal-front') || ''
    const back = cardItem.getAttribute('data-modal-back') || ''
    const sideways = cardItem.getAttribute('data-modal-sideways') === 'true'
    const isDfc = cardItem.getAttribute('data-modal-dfc') === 'true'
    const price = cardItem.getAttribute('data-modal-price') || ''
    const set = cardItem.getAttribute('data-modal-set') || ''
    const rarity = cardItem.getAttribute('data-modal-rarity') || ''
    const oracle = cardItem.getAttribute('data-modal-oracle') || ''
    const mana = cardItem.getAttribute('data-modal-mana') || ''

    nameEl.textContent = name
    typeEl.textContent = type
    manaEl.innerHTML = mana
    oracleEl.innerHTML = oracle.replace(/\n/g, '<br>')

    const metaParts: string[] = []
    if (price) metaParts.push(`$${price}`)
    if (set) metaParts.push(set)
    if (rarity) metaParts.push(rarity.charAt(0).toUpperCase() + rarity.slice(1))
    metaEl.innerHTML = metaParts.map((p) => `<span>${p}</span>`).join('')

    imgFront.src = front
    imgFront.alt = name
    imgFront.className = sideways ? 'sideways' : ''

    showingBack = false
    if (isDfc && back) {
      imgBack.src = back
      imgBack.alt = name + ' (Back)'
      imgBack.className = 'hidden'
      flipBtn.classList.remove('hidden')
    } else {
      imgBack.src = ''
      imgBack.className = 'hidden'
      flipBtn.classList.add('hidden')
    }

    backdrop.classList.add('open')
    document.body.style.overflow = 'hidden'
  }

  const closeModal = () => {
    backdrop.classList.remove('open')
    document.body.style.overflow = ''
  }

  // Flip DFC
  flipBtn.addEventListener('click', () => {
    showingBack = !showingBack
    if (showingBack) {
      imgFront.classList.add('hidden')
      imgBack.classList.remove('hidden')
    } else {
      imgFront.classList.remove('hidden')
      imgBack.classList.add('hidden')
    }
  })

  // Open modal on card click — works for binder, list, and overlap views
  document.body.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    // Overlap "Details" button
    if (target.hasAttribute('data-open-modal')) {
      e.preventDefault()
      e.stopPropagation()
      const cardItem = target.closest('.card-item') as HTMLElement | null
      if (cardItem) openModal(cardItem)
      return
    }

    // Binder card click
    const binder = target.closest('.card-binder') as HTMLElement | null
    if (binder) {
      const cardItem = binder.closest('.card-item') as HTMLElement | null
      if (cardItem && cardItem.hasAttribute('data-modal-name')) {
        e.preventDefault()
        openModal(cardItem)
      }
      return
    }

    // List row click
    const listRow = target.closest('.card-list') as HTMLElement | null
    if (listRow) {
      const cardItem = listRow.closest('.card-item') as HTMLElement | null
      if (cardItem && cardItem.hasAttribute('data-modal-name')) {
        e.preventDefault()
        openModal(cardItem)
      }
      return
    }

    // Overlap card click (on the image itself, not the details button)
    const overlapCard = target.closest('.card-overlap') as HTMLElement | null
    if (overlapCard) {
      const cardItem = overlapCard.closest('.card-item') as HTMLElement | null
      if (cardItem && cardItem.hasAttribute('data-modal-name')) {
        e.preventDefault()
        openModal(cardItem)
      }
      return
    }
  })

  // Close handlers
  closeBtn.addEventListener('click', closeModal)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal()
  })

  // ===== List-view hover tooltip =====
  const tooltip = document.createElement('div')
  tooltip.className = 'list-tooltip'
  const tooltipImg = document.createElement('img')
  tooltip.appendChild(tooltipImg)
  document.body.appendChild(tooltip)

  document.body.addEventListener('mouseover', (e) => {
    const listRow = (e.target as HTMLElement).closest('.card-list') as HTMLElement | null
    if (!listRow) return
    // Only show if list view is active (row is visible)
    if (listRow.offsetParent === null) return
    const src = listRow.getAttribute('data-tooltip-src')
    if (!src) return
    tooltipImg.src = src
    tooltip.classList.add('visible')
  })

  document.body.addEventListener('mouseout', (e) => {
    const listRow = (e.target as HTMLElement).closest('.card-list') as HTMLElement | null
    if (listRow) {
      tooltip.classList.remove('visible')
    }
  })

  document.body.addEventListener('mousemove', (e) => {
    if (!tooltip.classList.contains('visible')) return
    const tooltipW = 240
    const tooltipH = tooltip.offsetHeight || 340
    const margin = 16
    const x = e.clientX
    const y = e.clientY
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = x + margin
    let top = y - tooltipH / 2

    if (left + tooltipW > vw) left = x - tooltipW - margin
    if (top < margin) top = margin
    if (top + tooltipH > vh - margin) top = vh - tooltipH - margin

    tooltip.style.left = left + 'px'
    tooltip.style.top = top + 'px'
  })
})
