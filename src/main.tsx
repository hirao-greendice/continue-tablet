import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const preventDocumentScroll = (event: TouchEvent) => {
  if (event.cancelable) {
    event.preventDefault()
  }
}

document.addEventListener('touchmove', preventDocumentScroll, { passive: false })

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href)
    navigator.serviceWorker.register(swUrl).catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
