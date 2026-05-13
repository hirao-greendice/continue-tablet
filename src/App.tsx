import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  saveCurrentPhotos,
  subscribeCurrentPhotos,
  uploadCurrentPhoto,
  type StoredPhoto,
} from './photoStore'

type Screen = 'home' | 'scene1' | 'scene2' | 'scene3' | 'photos'
type PhotoSlot = {
  id: number
  label: string
  src: string
}

const defaultPhotos: PhotoSlot[] = [
  { id: 1, label: '雛用係の役', src: '/photos/team-photo-1.jpg' },
  { id: 2, label: '学芸員の役', src: '/photos/team-photo-2.jpg' },
  { id: 3, label: 'ケージーの役', src: '/photos/team-photo-3.jpg' },
]

const STAGE_WIDTH = 1200
const STAGE_HEIGHT = 1920

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

function getIsFullscreen() {
  return Boolean(document.fullscreenElement)
}

function getStageScale() {
  return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [, setTeamNumber] = useState<number | null>(null)
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(getIsFullscreen)
  const [stageScale, setStageScale] = useState(getStageScale)
  const [photos, setPhotos] = useState<PhotoSlot[]>(defaultPhotos)
  const [uploadStatus, setUploadStatus] = useState('')

  useEffect(() => {
    const fullscreenQuery: LegacyMediaQueryList = window.matchMedia(
      '(display-mode: fullscreen)',
    )
    const standaloneQuery: LegacyMediaQueryList = window.matchMedia(
      '(display-mode: standalone)',
    )

    const updateFullscreenState = () => {
      setIsFullscreen(getIsFullscreen())
    }

    document.addEventListener('fullscreenchange', updateFullscreenState)
    fullscreenQuery.addEventListener?.('change', updateFullscreenState)
    fullscreenQuery.addListener?.(updateFullscreenState)
    standaloneQuery.addEventListener?.('change', updateFullscreenState)
    standaloneQuery.addListener?.(updateFullscreenState)

    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState)
      fullscreenQuery.removeEventListener?.('change', updateFullscreenState)
      fullscreenQuery.removeListener?.(updateFullscreenState)
      standaloneQuery.removeEventListener?.('change', updateFullscreenState)
      standaloneQuery.removeListener?.(updateFullscreenState)
    }
  }, [])

  useEffect(() => {
    const updateStageScale = () => {
      setStageScale(getStageScale())
    }

    updateStageScale()
    window.addEventListener('resize', updateStageScale)
    window.addEventListener('orientationchange', updateStageScale)

    return () => {
      window.removeEventListener('resize', updateStageScale)
      window.removeEventListener('orientationchange', updateStageScale)
    }
  }, [])

  useEffect(() => {
    return subscribeCurrentPhotos((storedPhotos) => {
      setPhotos((currentPhotos) => mergeStoredPhotos(currentPhotos, storedPhotos))
    })
  }, [])

  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedPhotoId),
    [photos, selectedPhotoId],
  )

  const enterFullscreen = async () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => undefined)
    }
  }

  const startTeam = (team: number) => {
    setTeamNumber(team)
    setSelectedPhotoId(null)
    setScreen('scene1')
  }

  const updatePhoto = async (slotId: number, file: File | null) => {
    if (!file) {
      return
    }

    setUploadStatus('アップロード中...')

    try {
      const src = await uploadCurrentPhoto(slotId, file)
      const nextPhotos = photos.map((photo) =>
        photo.id === slotId ? { ...photo, src } : photo,
      )

      setPhotos(nextPhotos)
      await saveCurrentPhotos(toStoredPhotos(nextPhotos))
      setUploadStatus('更新しました')
    } catch {
      setUploadStatus('アップロードに失敗しました')
    }
  }

  return (
    <main className="app-frame">
      <div
        className="stage"
        data-screen={screen}
        style={
          {
            '--stage-scale': stageScale,
            '--stage-width': `${STAGE_WIDTH * stageScale}px`,
            '--stage-height': `${STAGE_HEIGHT * stageScale}px`,
          } as CSSProperties
        }
      >
        <div className="stage-content">
          {screen === 'home' && (
            <HomeScreen onStartTeam={startTeam} onOpenPhotos={() => setScreen('photos')} />
          )}

          {screen === 'scene1' && (
            <SceneOne
              onNext={() => setScreen('scene2')}
              onBack={() => setScreen('home')}
            />
          )}

          {screen === 'scene2' && (
            <SceneTwo onBack={() => setScreen('scene1')} onNext={() => setScreen('scene3')} />
          )}

          {screen === 'scene3' && (
            <SceneThree
              photos={photos}
              selectedPhoto={selectedPhoto}
              selectedPhotoId={selectedPhotoId}
              onBack={() => setScreen('scene2')}
              onSelect={setSelectedPhotoId}
            />
          )}

          {screen === 'photos' && (
            <PhotoManager
            photos={photos}
            uploadStatus={uploadStatus}
            onBack={() => setScreen('home')}
            onUpdatePhoto={updatePhoto}
          />
          )}
        </div>
      </div>

      {!isFullscreen && (
        <button className="fullscreen-control" type="button" onClick={enterFullscreen}>
          全画面
        </button>
      )}
    </main>
  )
}

function mergeStoredPhotos(currentPhotos: PhotoSlot[], storedPhotos: StoredPhoto[]) {
  return currentPhotos.map((photo) => {
    const storedPhoto = storedPhotos.find((item) => item.id === photo.id)
    return storedPhoto ? { ...photo, src: storedPhoto.src } : photo
  })
}

function toStoredPhotos(photos: PhotoSlot[]): StoredPhoto[] {
  return photos.map((photo) => ({
    id: photo.id,
    src: photo.src,
  }))
}

type HomeScreenProps = {
  onStartTeam: (team: number) => void
  onOpenPhotos: () => void
}

function HomeScreen({ onStartTeam, onOpenPhotos }: HomeScreenProps) {
  return (
    <section className="home-screen" aria-label="チーム選択">
      <div className="team-grid" aria-label="チーム番号">
        {Array.from({ length: 8 }, (_, index) => index + 1).map((team) => (
          <button
            className="team-button"
            key={team}
            type="button"
            onClick={() => onStartTeam(team)}
          >
            {team}
          </button>
        ))}
      </div>

      <div className="home-actions">
        <button className="home-action-button" type="button" disabled>
          MASTER
        </button>
        <button className="home-action-button" type="button" onClick={onOpenPhotos}>
          写真撮影
        </button>
      </div>
    </section>
  )
}

type SceneOneProps = {
  onBack: () => void
  onNext: () => void
}

function SceneOne({ onBack, onNext }: SceneOneProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)

  const playVideo = () => {
    setIsVideoPlaying(true)
    void videoRef.current?.play().catch(() => undefined)
  }

  return (
    <section className="story-screen scene-one">
      <div className="story-background scene-one-background" aria-hidden="true" />
      <button className="back-button" type="button" onClick={onBack}>
        戻る
      </button>
      <div className="scene-one-content">
        <div className="ribbon-title">
          <h1>天啓だよ！</h1>
          <p>これを読んで！</p>
        </div>
        <p>
          あのスタッフは君たちを無視したわけではなく、
          <br />
          記憶を消しただけなので安心して、
          <br />
          とりあえず私の話を集中してほしい。
        </p>
        <p>
          ゲームが始まる前に言ったように
          <br />
          いまこの会場には大変なことが起きているんだ。
        </p>
        <button
          className="video-box"
          data-playing={isVideoPlaying}
          type="button"
          aria-label="動画を再生"
          onClick={playVideo}
        >
          <video ref={videoRef} src="/videos/scene-1.mp4" playsInline />
          <span className="play-mark" />
          <span>再生する</span>
        </button>
      </div>
      <button className="primary-next scene-one-next" type="button" onClick={onNext}>
        次へ
      </button>
    </section>
  )
}

type SceneTwoProps = {
  onBack: () => void
  onNext: () => void
}

function SceneTwo({ onBack, onNext }: SceneTwoProps) {
  return (
    <section className="story-screen scene-two">
      <div className="story-background scene-two-background" aria-hidden="true" />
      <button className="back-button" type="button" onClick={onBack}>
        戻る
      </button>
      <div className="scene-two-content">
        <p>
          ということが起きているわけ。
          <br />
          さっきのスタッフのおかしい発言は、
          <br />
          公演を解いてもらうための必死の努力だったんだね。
        </p>
        <p>
          そういえば、この公演ではスタッフの人数によって、
          <br />
          キャラクターをキーボックスにしたり、
          <br />
          人間にしたりするようだよ。
        </p>
        <p>
          犯人が何をするか分からないので、
          <br />
          スタッフに迂闊に話しかけたり行動するのはやめよう。
          <br />
          先程の「忘却の一撃」は
          <br />
          1時間に1回しか打てないので、もう使えないんだ。
        </p>
        <p>
          ここで提案！
          <br />
          君たちが、犯人が誰か突き止めることさえできれば、
          <br />
          私が溜めてきた「改心の一撃」を放してあげる！
        </p>
      </div>
      <button className="primary-next scene-two-next" type="button" onClick={onNext}>
        犯人が誰か突き止める
      </button>
    </section>
  )
}

type SceneThreeProps = {
  photos: PhotoSlot[]
  selectedPhoto: PhotoSlot | undefined
  selectedPhotoId: number | null
  onBack: () => void
  onSelect: (photoId: number) => void
}

function SceneThree({
  photos,
  selectedPhoto,
  selectedPhotoId,
  onBack,
  onSelect,
}: SceneThreeProps) {
  return (
    <section className="story-screen scene-three">
      <div className="story-background scene-three-background" aria-hidden="true" />
      <header className="answer-header">
        <button className="back-button answer-back" type="button" onClick={onBack}>
          戻る
        </button>
        <h1>ホントの最終解答</h1>
      </header>

      <div className="answer-content">
        <h2>本物の強盗は：</h2>
        <div className="suspect-list">
          {photos.map((photo) => (
            <button
              className="suspect-card"
              data-selected={selectedPhotoId === photo.id}
              key={photo.id}
              type="button"
              onClick={() => onSelect(photo.id)}
            >
              <span className="suspect-number">{photo.id}</span>
              <span className="suspect-label">{photo.label}</span>
              <span className="suspect-frame">
                <img src={photo.src} alt={photo.label} />
              </span>
            </button>
          ))}
        </div>

        <div className="selection-area" aria-live="polite">
          {selectedPhoto ? (
            <>
              <span className="finger-indicator">☝</span>
              <strong>お前だ！</strong>
            </>
          ) : (
            <span className="empty-selection">選択してください</span>
          )}
        </div>

        <button
          className="submit-answer"
          type="button"
          disabled={!selectedPhoto}
          onClick={() => undefined}
        >
          天使に提出する
        </button>
      </div>
    </section>
  )
}

type PhotoManagerProps = {
  photos: PhotoSlot[]
  uploadStatus: string
  onBack: () => void
  onUpdatePhoto: (slotId: number, file: File | null) => Promise<void>
}

function PhotoManager({ photos, uploadStatus, onBack, onUpdatePhoto }: PhotoManagerProps) {
  return (
    <section className="photo-manager" aria-label="写真撮影">
      <button className="back-button photo-back" type="button" onClick={onBack}>
        戻る
      </button>
      <div className="photo-manager-inner">
        <h1>写真撮影</h1>
        <p>3枚の写真を選ぶと、最終解答の候補画像に反映されます。</p>
        {uploadStatus && <div className="upload-status">{uploadStatus}</div>}
        <div className="photo-editor-list">
          {photos.map((photo) => (
            <article className="photo-editor" key={photo.id}>
              <img src={photo.src} alt={`${photo.label}の現在の写真`} />
              <div>
                <h2>{photo.id}. {photo.label}</h2>
                <label className="photo-input-button">
                  撮影・選択
                  <input
                    accept="image/*"
                    capture="environment"
                    type="file"
                    onChange={(event) => {
                      void onUpdatePhoto(photo.id, event.target.files?.[0] ?? null)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default App
