import { type CSSProperties, useEffect, useState } from 'react'
import './App.css'

const colorTiles = [
  {
    name: 'Cyan',
    value: '#00c2ff',
  },
  {
    name: 'Lime',
    value: '#9dff5f',
  },
  {
    name: 'Coral',
    value: '#ff6f59',
  },
]

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

function getDisplayMode() {
  const iosStandalone =
    'standalone' in window.navigator &&
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)

  if (iosStandalone) {
    return 'standalone'
  }

  if (window.matchMedia('(display-mode: fullscreen)').matches) {
    return 'fullscreen'
  }

  if (window.matchMedia('(display-mode: standalone)').matches) {
    return 'standalone'
  }

  return 'browser'
}

function App() {
  const [displayMode, setDisplayMode] = useState(getDisplayMode)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))

  useEffect(() => {
    const fullscreenQuery: LegacyMediaQueryList = window.matchMedia(
      '(display-mode: fullscreen)',
    )
    const standaloneQuery: LegacyMediaQueryList = window.matchMedia(
      '(display-mode: standalone)',
    )

    const updateViewportState = () => {
      setDisplayMode(getDisplayMode())
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', updateViewportState)
    fullscreenQuery.addEventListener?.('change', updateViewportState)
    fullscreenQuery.addListener?.(updateViewportState)
    standaloneQuery.addEventListener?.('change', updateViewportState)
    standaloneQuery.addListener?.(updateViewportState)

    return () => {
      document.removeEventListener('fullscreenchange', updateViewportState)
      fullscreenQuery.removeEventListener?.('change', updateViewportState)
      fullscreenQuery.removeListener?.(updateViewportState)
      standaloneQuery.removeEventListener?.('change', updateViewportState)
      standaloneQuery.removeListener?.(updateViewportState)
    }
  }, [])

  const enterFullscreen = async () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen()
      } catch {
        setIsFullscreen(Boolean(document.fullscreenElement))
      }
    }
  }

  return (
    <main className="tablet-shell" aria-label="Tablet fullscreen test">
      <section className="status-card">
        <p className="eyebrow">Tablet app mode test</p>
        <h1>フルスクリーン固定テスト</h1>
        <p className="description">
          ホーム画面に追加してアプリとして開くと、ブラウザの上部UIを出さずに表示できるか確認できます。
        </p>
        <div className="status-grid" aria-label="Current display status">
          <span>表示モード: {displayMode}</span>
          <span>Fullscreen API: {isFullscreen ? 'on' : 'off'}</span>
        </div>
        <button className="fullscreen-button" type="button" onClick={enterFullscreen}>
          フルスクリーンにする
        </button>
      </section>

      <section className="color-board" aria-label="Three color tablet test">
        {colorTiles.map((tile) => (
          <article
            className="color-tile"
            key={tile.name}
            style={{ '--tile-color': tile.value } as CSSProperties}
          >
            <span>{tile.name}</span>
          </article>
        ))}
      </section>
    </main>
  )
}

export default App
