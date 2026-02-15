// Copy deck text to clipboard logic
document.addEventListener('DOMContentLoaded', () => {
  const copyBtns = document.querySelectorAll('[data-copy-src]')
  copyBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-copy-src')
      if (!url) return

      const buttonEl = btn as HTMLElement

      try {
        const originalText = buttonEl.innerText
        buttonEl.innerText = 'Fetching...'

        const response = await fetch(url)
        if (!response.ok) throw new Error('Failed to fetch deck list')
        const text = await response.text()

        await navigator.clipboard.writeText(text)
        buttonEl.innerText = 'Copied!'
        setTimeout(() => (buttonEl.innerText = originalText), 2000)
      } catch (e) {
        console.error('Copy failed', e)
        buttonEl.innerText = 'Error!'
      }
    })
  })
})
