// Deck filtering, sorting, and view-mode logic
interface CardData {
  element: HTMLElement
  originalParent: HTMLElement | null
  name: string
  cmc: number
  edhrec: number
  price: number
  type: string
  section: string
}

type ViewMode = 'binder' | 'list' | 'overlap' | 'stack'

document.addEventListener('DOMContentLoaded', () => {
  const groupSelect = document.getElementById('sort-group') as HTMLSelectElement
  const sortSelect = document.getElementById('sort-by') as HTMLSelectElement
  const reverseCheck = document.getElementById('sort-reverse') as HTMLInputElement
  const landCheck = document.getElementById('filter-lands') as HTMLInputElement
  const extrasCheck = document.getElementById('show-extras') as HTMLInputElement
  const container = document.querySelector('.space-y-6') as HTMLElement | null
  const viewToggle = document.getElementById('view-toggle')

  if (!container || !groupSelect || !sortSelect || !reverseCheck || !landCheck || !extrasCheck) {
    return
  }

  let currentView: ViewMode = 'binder'

  // View mode toggle
  if (viewToggle) {
    viewToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null
      if (!btn) return
      const mode = btn.getAttribute('data-view') as ViewMode
      if (mode && mode !== currentView) {
        currentView = mode
        viewToggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        applyViewMode()
      }
    })
  }

  const applyViewMode = () => {
    // Apply view class on all section containers (including dynamic)
    container.classList.remove('view-binder', 'view-list', 'view-overlap', 'view-stack')
    container.classList.add(`view-${currentView}`)

    // Update grid classes
    container.querySelectorAll('.binder-grid, .card-grid').forEach((grid) => {
      // Reset to base class so CSS view rules take effect
      grid.className = currentView === 'binder' ? 'binder-grid' : 'binder-grid'
    })
  }

  // Store original sections structure in allCards
  let allCards: CardData[] = []
  let sectionOrder: string[] = []

  document.querySelectorAll('.card-item').forEach((el) => {
    const parentContainer = el.closest('.binder-grid')
    if (!parentContainer) return

    const sectionDiv = el.closest('[data-section]') as HTMLElement | null
    const sectionName = sectionDiv?.getAttribute('data-section') || ''
    if (!sectionOrder.includes(sectionName)) sectionOrder.push(sectionName)

    allCards.push({
      element: el as HTMLElement,
      originalParent: el.parentElement,
      name: el.getAttribute('data-name') || '',
      cmc: parseFloat(el.getAttribute('data-cmc') || '0'),
      edhrec: parseInt(el.getAttribute('data-edhrec') || '999999'),
      price: parseFloat(el.getAttribute('data-price') || '0'),
      type: el.getAttribute('data-type') || '',
      section: sectionName,
    })
  })

  const updateView = () => {
    const groupBy = groupSelect.value
    const sortBy = sortSelect.value
    const reverse = reverseCheck.checked
    const hideLands = landCheck.checked
    const showExtras = extrasCheck.checked

    const sections = Array.from(container.children) as HTMLElement[]
    let dynamicContainer = document.getElementById('dynamic-sort-container')

    if (!dynamicContainer) {
      dynamicContainer = document.createElement('div')
      dynamicContainer.id = 'dynamic-sort-container'
      dynamicContainer.className = 'space-y-6'
      container.appendChild(dynamicContainer)
    }

    // Hide original sections except Commander
    sections.forEach((sec) => {
      const secName = sec.getAttribute('data-section') || ''
      if (secName.toLowerCase().includes('commander')) {
        sec.style.display = 'block'
      } else if (sec.id !== 'dynamic-sort-container') {
        sec.style.display = 'none'
      }
    })

    dynamicContainer.innerHTML = ''

    // Filter available cards (excluding commander)
    let workingCards = allCards.filter(
      (c) =>
        !c.section.toLowerCase().includes('commander') &&
        !c.element.closest('#dynamic-sort-container'),
    )

    // Filter: Extras
    if (!showExtras) {
      workingCards = workingCards.filter((c) => {
        const s = c.section.toLowerCase()
        if (s.includes('sideboard') || s.includes('maybeboard') || s.includes('token')) return false
        return true
      })
    }

    // Filter: Hide Lands
    if (hideLands) {
      workingCards = workingCards.filter(
        (c) => !(c.cmc === 0 && (c.type.includes('Land') || c.type.includes('Basic'))),
      )
    }

    // Sort function
    const sortFn = (a: CardData, b: CardData) => {
      if (sortBy === 'name') {
        return reverse ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
      } else if (sortBy === 'cmc' || sortBy === 'price' || sortBy === 'edhrec') {
        const key = sortBy as 'cmc' | 'price' | 'edhrec'
        return reverse ? b[key] - a[key] : a[key] - b[key]
      }
      return 0
    }

    // Grouping Logic
    let groups: Record<string, CardData[]> = {}

    if (groupBy === 'none') {
      groups['Full Deck'] = workingCards.sort(sortFn)
    } else if (groupBy === 'cmc') {
      workingCards.forEach((c) => {
        const key = c.cmc.toString()
        if (!groups[key]) groups[key] = []
        groups[key].push(c)
      })
    } else if (groupBy === 'type') {
      const getType = (t: string) => {
        if (t.includes('Creature')) return 'Creature'
        if (t.includes('Planeswalker')) return 'Planeswalker'
        if (t.includes('Instant')) return 'Instant'
        if (t.includes('Sorcery')) return 'Sorcery'
        if (t.includes('Artifact')) return 'Artifact'
        if (t.includes('Enchantment')) return 'Enchantment'
        if (t.includes('Land')) return 'Land'
        return 'Other'
      }

      workingCards.forEach((c) => {
        const key = getType(c.type)
        if (!groups[key]) groups[key] = []
        groups[key].push(c)
      })
    } else if (groupBy === 'section') {
      workingCards.forEach((c) => {
        const key = c.section
        if (!groups[key]) groups[key] = []
        groups[key].push(c)
      })
    }

    // Sort group keys
    let keys = Object.keys(groups)
    if (groupBy === 'cmc') {
      keys.sort((a, b) => parseInt(a) - parseInt(b))
    } else if (groupBy === 'type') {
      const order = [
        'Creature',
        'Planeswalker',
        'Instant',
        'Sorcery',
        'Artifact',
        'Enchantment',
        'Land',
        'Other',
      ]
      keys.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    } else if (groupBy === 'section') {
      keys.sort((a, b) => sectionOrder.indexOf(a) - sectionOrder.indexOf(b))
    }

    keys.forEach((key) => {
      const groupCards = groups[key]
      if (!groupCards || groupCards.length === 0) return

      groupCards.sort(sortFn)

      // Section divider
      const sectionId = key.replace(/[^a-zA-Z0-9]/g, '_')
      const divider = document.createElement('div')
      divider.className = 'section-divider'
      divider.id = sectionId

      const header = document.createElement('h2')
      header.innerHTML = `<a href="#${sectionId}">${key}</a>`

      const count = document.createElement('span')
      count.className = 'section-count'
      count.textContent = String(groupCards.length)

      divider.appendChild(header)
      divider.appendChild(count)

      // Grid
      const grid = document.createElement('div')
      grid.className = 'binder-grid'

      groupCards.forEach((c) => {
        grid.appendChild(c.element)
      })

      const secDiv = document.createElement('div')
      secDiv.appendChild(divider)
      secDiv.appendChild(grid)
      if (dynamicContainer) dynamicContainer.appendChild(secDiv)
    })

    // Reapply view mode after DOM rebuild
    applyViewMode()
  }

  // Listeners
  groupSelect.addEventListener('change', updateView)
  sortSelect.addEventListener('change', updateView)
  reverseCheck.addEventListener('change', updateView)
  landCheck.addEventListener('change', updateView)
  extrasCheck.addEventListener('change', updateView)

  // Initial run
  updateView()
})
