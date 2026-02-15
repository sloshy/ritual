// Card preview tooltip logic
document.addEventListener('DOMContentLoaded', () => {
  const tooltip = document.createElement('div')
  tooltip.className =
    'fixed z-50 pointer-events-none hidden rounded-xl shadow-xl border border-gray-600 bg-black w-64'

  const img = document.createElement('img')
  img.className = 'w-full rounded-xl'
  tooltip.appendChild(img)
  document.body.appendChild(tooltip)

  document.body.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest('[data-preview-src]')
    if (target) {
      const src = target.getAttribute('data-preview-src')
      if (src) img.src = src

      const shouldRotate = target.getAttribute('data-rotate') === 'true'

      if (shouldRotate) {
        // Sideways card: Rotate 90deg and center in landscape tooltip
        tooltip.className =
          'fixed z-50 pointer-events-none hidden rounded-xl shadow-xl border border-gray-600 bg-black flex items-center justify-center w-[358px] h-[256px]'
        img.className = 'w-[256px] rounded-xl rotate-90 origin-center'
      } else {
        // Normal card
        tooltip.className =
          'fixed z-50 pointer-events-none hidden rounded-xl shadow-xl border border-gray-600 bg-black w-64'
        img.className = 'w-full rounded-xl'
        img.classList.remove('rotate-90')
      }

      tooltip.classList.remove('hidden')
    }
  })

  document.body.addEventListener('mouseout', (e) => {
    const target = (e.target as HTMLElement).closest('[data-preview-src]')
    if (target) {
      tooltip.classList.add('hidden')
      // Reset to default to avoid flicker/flash wrong size
      tooltip.className =
        'fixed z-50 pointer-events-none hidden rounded-xl shadow-xl border border-gray-600 bg-black w-64'
      img.className = 'w-full rounded-xl'
    }
  })

  document.body.addEventListener('mousemove', (e) => {
    if (!tooltip.classList.contains('hidden')) {
      // Dynamic dimensions based on current rotation/sizing
      const tooltipWidth = tooltip.offsetWidth
      const tooltipHeight = tooltip.offsetHeight
      const margin = 16

      const x = e.clientX
      const y = e.clientY

      let translateX = '-100%'
      let translateY = '-100%'

      // Position tooltip to top-left of cursor, flipping to bottom/right if out of bounds

      // Check Top Edge
      // Top edge of tooltip would be y - height - margin
      if (y - tooltipHeight - margin < 0) {
        translateY = '0%' // Moves it below the cursor
      } else {
        translateY = '-100%' // Keeps it above (default)
      }

      // Check Left Edge
      // Left edge of tooltip would be x - width - margin
      if (x - tooltipWidth - margin < 0) {
        translateX = '0%' // Moves it to right of cursor
      } else {
        translateX = '-100%' // Moves it to left (default)
      }

      const offset = 16
      const finalX = translateX === '-100%' ? x - offset : x + offset
      const finalY = translateY === '-100%' ? y - offset : y + offset

      tooltip.style.left = finalX + 'px'
      tooltip.style.top = finalY + 'px'
      tooltip.style.transform = 'translate(' + translateX + ', ' + translateY + ')'
    }
  })
})
