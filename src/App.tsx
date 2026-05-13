import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import './App.css'
import { createCroppedPhotoFile } from './cropImage'
import {
  saveCurrentPhotos,
  subscribeCurrentPhotos,
  uploadCurrentPhoto,
  type StoredPhoto,
} from './photoStore'
import {
  connectTeamPresence,
  subscribeRealtimeConnection,
  submitTeamAnswer,
  subscribeTeamStates,
  type TeamState,
} from './teamStore'
import { realtimeDatabaseUrl } from './firebase'

type Screen = 'home' | 'scene1' | 'scene2' | 'scene3' | 'photos' | 'master'
type PhotoSlot = {
  id: number
  label: string
  src: string
}
type CropDraft = {
  slotId: number
  label: string
  src: string
}

function publicAsset(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

const SCENE_ONE_VIDEO_VERSION = 'scene-1-20260513-1'

const defaultPhotos: PhotoSlot[] = [
  { id: 1, label: '雑用係の役', src: publicAsset('photos/team-photo-1.jpg') },
  { id: 2, label: '学芸員の役', src: publicAsset('photos/team-photo-2.jpg') },
  { id: 3, label: 'ケージーの役', src: publicAsset('photos/team-photo-3.jpg') },
]

const STAGE_WIDTH = 1200
const STAGE_HEIGHT = 1920
const TEAM_STALE_MS = 45_000

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
  const [teamNumber, setTeamNumber] = useState<number | null>(null)
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null)
  const [submittedPhotoId, setSubmittedPhotoId] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(getIsFullscreen)
  const [stageScale, setStageScale] = useState(getStageScale)
  const [photos, setPhotos] = useState<PhotoSlot[]>(defaultPhotos)
  const [teamStates, setTeamStates] = useState<TeamState[]>(createEmptyTeamStates)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [realtimeError, setRealtimeError] = useState('')
  const [masterNow, setMasterNow] = useState(() => Date.now())
  const [uploadStatus, setUploadStatus] = useState('')
  const [secretMenuOpen, setSecretMenuOpen] = useState(false)
  const preloadedPhotoImages = useRef<Map<string, HTMLImageElement>>(new Map())
  const secretTapCount = useRef(0)
  const secretTapResetTimer = useRef<number | undefined>(undefined)

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

  useEffect(() => {
    return subscribeTeamStates(setTeamStates, setRealtimeError)
  }, [])

  useEffect(() => {
    return subscribeRealtimeConnection(setRealtimeConnected)
  }, [])

  useEffect(() => {
    if (!teamNumber) {
      return
    }

    return connectTeamPresence(teamNumber, setRealtimeError)
  }, [teamNumber])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMasterNow(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (screen !== 'home' && screen !== 'scene2') {
      return
    }

    photos.forEach((photo) => {
      if (preloadedPhotoImages.current.has(photo.src)) {
        return
      }

      const image = new Image()
      preloadedPhotoImages.current.set(photo.src, image)
      image.addEventListener(
        'error',
        () => {
          preloadedPhotoImages.current.delete(photo.src)
        },
        { once: true },
      )
      image.src = photo.src
    })
  }, [photos, screen])

  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedPhotoId),
    [photos, selectedPhotoId],
  )
  const submittedPhoto = useMemo(
    () => photos.find((photo) => photo.id === submittedPhotoId),
    [photos, submittedPhotoId],
  )

  const enterFullscreen = async () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => undefined)
    }
  }

  const exitFullscreen = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen().catch(() => undefined)
    }
  }

  const startTeam = (team: number) => {
    void enterFullscreen()
    setTeamNumber(team)
    setSelectedPhotoId(null)
    setSubmittedPhotoId(null)
    setScreen('scene1')
  }

  const goHome = () => {
    setTeamNumber(null)
    setSelectedPhotoId(null)
    setSubmittedPhotoId(null)
    setSecretMenuOpen(false)
    setScreen('home')
  }

  const tapSecretHotspot = () => {
    window.clearTimeout(secretTapResetTimer.current)
    secretTapCount.current += 1

    if (secretTapCount.current >= 5) {
      secretTapCount.current = 0
      setSecretMenuOpen(true)
      return
    }

    secretTapResetTimer.current = window.setTimeout(() => {
      secretTapCount.current = 0
    }, 1200)
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

  const submitAnswer = async () => {
    if (!teamNumber || !selectedPhoto) {
      return
    }

    await submitTeamAnswer(teamNumber, {
      label: getAnswerLabel(selectedPhoto.id),
      photoId: selectedPhoto.id,
    })
    setSubmittedPhotoId(selectedPhoto.id)
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
            <HomeScreen
              photos={photos}
              onStartTeam={startTeam}
              onOpenMaster={() => setScreen('master')}
              onOpenPhotos={() => setScreen('photos')}
            />
          )}

          {screen === 'scene1' && (
            <SceneOne
              onNext={() => setScreen('scene2')}
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
              submittedPhoto={submittedPhoto}
              onBack={() => setScreen('scene2')}
              onRetry={() => setSubmittedPhotoId(null)}
              onSelect={setSelectedPhotoId}
              onSubmit={submitAnswer}
            />
          )}

          {screen === 'master' && (
            <MasterScreen
              now={masterNow}
              realtimeConnected={realtimeConnected}
              realtimeError={realtimeError}
              teams={teamStates}
              onBack={() => setScreen('home')}
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

      <button
        className="secret-hotspot"
        type="button"
        aria-label="管理メニュー"
        onClick={tapSecretHotspot}
      />

      {secretMenuOpen && (
        <SecretMenu
          onClose={() => setSecretMenuOpen(false)}
          onExitFullscreen={exitFullscreen}
          onGoHome={goHome}
        />
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

function createEmptyTeamStates() {
  return Array.from({ length: 8 }, (_, index) => ({ team: index + 1 }))
}

function getAnswerLabel(photoId: number) {
  if (photoId === 1) {
    return '雑用係'
  }

  if (photoId === 2) {
    return '学芸員'
  }

  return 'ケージー'
}

function isTeamAlive(team: TeamState, now: number) {
  if (!team.online) {
    return false
  }

  if (!team.lastSeen) {
    return true
  }

  return now - team.lastSeen < TEAM_STALE_MS
}

type SecretMenuProps = {
  onClose: () => void
  onExitFullscreen: () => Promise<void>
  onGoHome: () => void
}

function SecretMenu({ onClose, onExitFullscreen, onGoHome }: SecretMenuProps) {
  return (
    <div className="secret-menu-backdrop" role="dialog" aria-modal="true" aria-label="管理メニュー">
      <div className="secret-menu-panel">
        <button className="secret-close" type="button" onClick={onClose}>
          閉じる
        </button>
        <button
          className="secret-action secret-action-blue"
          type="button"
          onClick={() => void onExitFullscreen()}
        >
          フルスクリーン
          <br />
          を解除する
        </button>
        <button className="secret-action secret-action-pink" type="button" onClick={onGoHome}>
          ホーム
          <br />
          に戻る
        </button>
      </div>
    </div>
  )
}

type HomeScreenProps = {
  photos: PhotoSlot[]
  onOpenMaster: () => void
  onStartTeam: (team: number) => void
  onOpenPhotos: () => void
}

function HomeScreen({ photos, onOpenMaster, onStartTeam, onOpenPhotos }: HomeScreenProps) {
  return (
    <section className="home-screen" aria-label="チーム選択">
      <div className="home-photo-strip" aria-label="現在の写真">
        {photos.map((photo) => (
          <article className="home-photo-card" key={photo.id}>
            <img src={photo.src} alt={`${photo.label}の現在の写真`} />
            <span>{photo.id}. {photo.label}</span>
          </article>
        ))}
      </div>

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
        <button className="home-action-button" type="button" onClick={onOpenMaster}>
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
  onNext: () => void
}

function SceneOne({ onNext }: SceneOneProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)

  const playVideo = async () => {
    try {
      await videoRef.current?.play()
      setIsVideoPlaying(true)
    } catch {
      setIsVideoPlaying(false)
    }
  }

  return (
    <section className="story-screen scene-one">
      <div
        className="story-background"
        style={{ backgroundImage: `url("${publicAsset('backgrounds/scene-1.jpg')}")` }}
        aria-hidden="true"
      />
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
        <p>
          文字で説明するより聞かせたほうがいいか。
          <br />
          みんながこの会場に入る前に私がみた光景を、
          <br />
          なるべくリアルに再現するね。
        </p>
        <button
          className="video-box"
          data-playing={isVideoPlaying}
          type="button"
          aria-label="動画を再生"
          onClick={() => void playVideo()}
        >
          <video
            ref={videoRef}
            src={publicAsset(`videos/scene-1.mp4?v=${SCENE_ONE_VIDEO_VERSION}`)}
            preload="metadata"
            playsInline
          />
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
      <div
        className="story-background"
        style={{ backgroundImage: `url("${publicAsset('backgrounds/scene-2.jpg')}")` }}
        aria-hidden="true"
      />
      <button className="back-button scene-two-back" type="button" onClick={onBack}>
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
          <br />
          それで、もともとは今日キーボックスがあったはずの
          <br />
          ところに犯人が立っているようだ。
        </p>
        <p>
          犯人が何をするか分からないので、
          <br />
          スタッフに迂闊に話しかけたり行動するのはやめよう。
          <br />
          先程の「忘却の一撃」は
          <br />
          1時間に1回しか打てないので、もう使えないんだ。
          <br />
          今はとにかくゲームが続いているようにみせよう。
        </p>
        <p>
          でも、このままほっといても、強盗はこのあと、
          <br />
          この会場にお金があまりないことに気づき、
          <br />
          結局暴れることにはなるんだよね…
        </p>
        <p>
          ここで提案！
          <br />
          君たちが、犯人が誰か突き止めることさえできれば、
          <br />
          私が溜めてきた「改心の一撃」を放してあげる！
          <br />
          <br />
          「改心の一撃」がフルチャージするのは
          <br />
          ちょうどゲームが終わる瞬間
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
  submittedPhoto: PhotoSlot | undefined
  onBack: () => void
  onRetry: () => void
  onSelect: (photoId: number) => void
  onSubmit: () => Promise<void>
}

function SceneThree({
  photos,
  selectedPhoto,
  selectedPhotoId,
  submittedPhoto,
  onBack,
  onRetry,
  onSelect,
  onSubmit,
}: SceneThreeProps) {
  if (submittedPhoto) {
    return <SubmittedAnswerScreen photo={submittedPhoto} onRetry={onRetry} />
  }

  return (
    <section className="story-screen scene-three">
      <div
        className="story-background"
        style={{ backgroundImage: `url("${publicAsset('backgrounds/scene-3.jpg')}")` }}
        aria-hidden="true"
      />
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
          onClick={() => void onSubmit()}
        >
          天使に提出する
        </button>
      </div>
    </section>
  )
}

type SubmittedAnswerScreenProps = {
  photo: PhotoSlot
  onRetry: () => void
}

function SubmittedAnswerScreen({ photo, onRetry }: SubmittedAnswerScreenProps) {
  return (
    <section className="submitted-answer-screen" aria-label="提出した回答">
      <h1>強盗は…</h1>
      <div className="submitted-answer-layout">
        <div className="submitted-suspect">
          <span className="submitted-number">{photo.id}</span>
          <span className="submitted-label">{photo.label}</span>
          <img src={photo.src} alt={photo.label} />
        </div>
        <p>だ！！</p>
      </div>
      <button className="retry-answer" type="button" onClick={onRetry}>
        選び直す
      </button>
      <p className="submitted-note">
        ※判定は<span>ゲーム終了時</span>に行います
        <br />
        この画面のままお待ちください
      </p>
    </section>
  )
}

type MasterScreenProps = {
  now: number
  realtimeConnected: boolean
  realtimeError: string
  teams: TeamState[]
  onBack: () => void
}

function MasterScreen({
  now,
  realtimeConnected,
  realtimeError,
  teams,
  onBack,
}: MasterScreenProps) {
  return (
    <section className="master-screen" aria-label="MASTER">
      <button className="master-back" type="button" onClick={onBack}>
        戻る
      </button>
      <h1>MASTER</h1>
      <div className="master-connection" data-connected={realtimeConnected}>
        RTDB {realtimeConnected ? '接続中' : '未接続'}
      </div>
      {realtimeError && <div className="master-error">{realtimeError}</div>}
      <div className="master-url">{realtimeDatabaseUrl}</div>

      <div className="master-team-grid">
        {teams.map((team) => {
          const answer = team.answer
          const isCorrect = answer?.photoId === 2 || answer?.label === '学芸員'

          return (
            <article className="master-team" key={team.team}>
              <div className="master-team-number" data-alive={isTeamAlive(team, now)}>
                {team.team}
              </div>
              <div className="master-team-answer" data-correct={isCorrect}>
                {answer?.label ?? ''}
              </div>
            </article>
          )
        })}
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
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null)
  const objectUrls = useRef<string[]>([])

  useEffect(() => {
    const createdObjectUrls = objectUrls.current

    return () => {
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const openCropper = (photo: PhotoSlot, file: File | null) => {
    if (!file) {
      return
    }

    const src = URL.createObjectURL(file)
    objectUrls.current.push(src)
    setCropDraft({
      slotId: photo.id,
      label: photo.label,
      src,
    })
  }

  return (
    <section className="photo-manager" data-scrollable="true" aria-label="写真撮影">
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
                  撮影・撮り直し
                  <input
                    accept="image/*"
                    capture="environment"
                    type="file"
                    onChange={(event) => {
                      openCropper(photo, event.target.files?.[0] ?? null)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>
      {cropDraft &&
        createPortal(
          <PhotoCropDialog
            draft={cropDraft}
            onCancel={() => setCropDraft(null)}
            onUpdate={async (file) => {
              await onUpdatePhoto(cropDraft.slotId, file)
              setCropDraft(null)
            }}
          />,
          document.body,
        )}
    </section>
  )
}

type PhotoCropDialogProps = {
  draft: CropDraft
  onCancel: () => void
  onUpdate: (file: File) => Promise<void>
}

function PhotoCropDialog({ draft, onCancel, onUpdate }: PhotoCropDialogProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  const updatePhoto = async () => {
    if (!croppedAreaPixels) {
      return
    }

    setIsUpdating(true)

    try {
      const file = await createCroppedPhotoFile(draft.src, croppedAreaPixels, draft.slotId)
      await onUpdate(file)
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div
      className="crop-dialog"
      data-scrollable="true"
      role="dialog"
      aria-modal="true"
      aria-label="写真の切り取り"
    >
      <div className="crop-panel">
        <header className="crop-header">
          <h2>{draft.slotId}. {draft.label}</h2>
          <button className="crop-cancel" type="button" onClick={onCancel}>
            キャンセル
          </button>
        </header>

        <div className="crop-area">
          <Cropper
            image={draft.src}
            crop={crop}
            zoom={zoom}
            aspect={15 / 26}
            objectFit="contain"
            onCropChange={setCrop}
            onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
            onZoomChange={setZoom}
          />
        </div>

        <div className="crop-controls">
          <label>
            拡大
            <input
              max="3"
              min="1"
              step="0.01"
              type="range"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <button
            className="crop-update"
            type="button"
            disabled={isUpdating}
            onClick={() => void updatePhoto()}
          >
            {isUpdating ? '更新中...' : '更新する'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
