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
  updatedAt?: number
}
type CropDraft = {
  slotId: number
  label: string
  src: string
}

function publicAsset(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

const SCENE_ONE_VIDEO_VERSION = 'scene-1-20260519-1'
const CLICK_SOUND = 'sounds/click.mp3'
const SUBMIT_SOUND = 'sounds/omaeda.mp3'

function playSound(path: string) {
  const sound = new Audio(publicAsset(path))
  void sound.play().catch(() => undefined)
}

const defaultPhotos: PhotoSlot[] = [
  { id: 1, label: '雑用係の役', src: publicAsset('photos/team-photo-1.jpg') },
  { id: 2, label: '学芸員の役', src: publicAsset('photos/team-photo-2.jpg') },
  { id: 3, label: '警察役', src: publicAsset('photos/team-photo-3.jpg') },
  { id: 4, label: 'ケージーの役', src: publicAsset('photos/team-photo-4.jpg') },
]

const STAGE_WIDTH = 1200
const STAGE_HEIGHT = 1920

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

type BatteryManager = EventTarget & {
  charging: boolean
  level: number
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManager>
}

type BatteryStatus = {
  charging: boolean
  level: number | null
  supported: boolean
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
  const [masterAnswerResetAt, setMasterAnswerResetAt] = useState<number | null>(null)
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
    if (screen !== 'master') {
      return
    }

    return subscribeTeamStates(setTeamStates, setRealtimeError)
  }, [screen])

  useEffect(() => {
    if (screen !== 'master') {
      return
    }

    return subscribeRealtimeConnection(setRealtimeConnected)
  }, [screen])

  useEffect(() => {
    if (!teamNumber) {
      return
    }

    return connectTeamPresence(teamNumber, setRealtimeError)
  }, [teamNumber])

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

  const exitFullscreenFromSecretMenu = async () => {
    await exitFullscreen()
    setSecretMenuOpen(false)
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
      const updatedAt = Date.now()
      const nextPhotos = photos.map((photo) =>
        photo.id === slotId ? { ...photo, src, updatedAt } : photo,
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

  const resetMasterAnswers = () => {
    setMasterAnswerResetAt(Date.now())
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
              realtimeConnected={realtimeConnected}
              realtimeError={realtimeError}
              answerResetAt={masterAnswerResetAt}
              teams={teamStates}
              onBack={() => setScreen('home')}
              onResetAnswers={resetMasterAnswers}
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
          onExitFullscreen={exitFullscreenFromSecretMenu}
          onGoHome={goHome}
        />
      )}
    </main>
  )
}

function mergeStoredPhotos(currentPhotos: PhotoSlot[], storedPhotos: StoredPhoto[]) {
  const hasFourthPhoto = storedPhotos.some((item) => item.id === 4)
  const legacyCageyPhoto = hasFourthPhoto
    ? undefined
    : storedPhotos.find((item) => item.id === 3)

  return currentPhotos.map((photo) => {
    const storedPhoto = photo.id === 4 && legacyCageyPhoto
      ? legacyCageyPhoto
      : storedPhotos.find((item) => item.id === photo.id)

    if (photo.id === 3 && legacyCageyPhoto) {
      return photo
    }

    return storedPhoto
      ? {
          ...photo,
          src: storedPhoto.src,
          updatedAt: storedPhoto.updatedAt ?? getPhotoVersionTimestamp(storedPhoto.src),
        }
      : photo
  })
}

function toStoredPhotos(photos: PhotoSlot[]): StoredPhoto[] {
  return photos.map((photo) => ({
    id: photo.id,
    src: photo.src,
    updatedAt: photo.updatedAt,
  }))
}

function getPhotoVersionTimestamp(src: string) {
  const version = new URL(src, window.location.href).searchParams.get('v')
  const timestamp = Number(version)

  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined
}

const photoUpdatedAtFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function formatPhotoUpdatedAt(updatedAt: number | undefined) {
  if (!updatedAt) {
    return '更新日時: 未更新'
  }

  return `更新日時: ${photoUpdatedAtFormatter.format(new Date(updatedAt))}`
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

  if (photoId === 3) {
    return '警察'
  }

  return 'ケージー'
}

function isTeamAlive(team: TeamState) {
  return Boolean(team.online)
}

function useBatteryStatus() {
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus>(() => ({
    charging: false,
    level: null,
    supported:
      typeof navigator !== 'undefined'
        && Boolean((navigator as NavigatorWithBattery).getBattery),
  }))

  useEffect(() => {
    const getBattery = (navigator as NavigatorWithBattery).getBattery

    if (!getBattery) {
      return
    }

    let battery: BatteryManager | null = null
    let isDisposed = false

    const updateBatteryStatus = () => {
      if (!battery) {
        return
      }

      setBatteryStatus({
        charging: battery.charging,
        level: battery.level,
        supported: true,
      })
    }

    void getBattery.call(navigator)
      .then((nextBattery) => {
        if (isDisposed) {
          return
        }

        battery = nextBattery
        updateBatteryStatus()
        battery.addEventListener('chargingchange', updateBatteryStatus)
        battery.addEventListener('levelchange', updateBatteryStatus)
      })
      .catch(() => {
        if (!isDisposed) {
          setBatteryStatus((currentStatus) => ({
            ...currentStatus,
            supported: false,
          }))
        }
      })

    return () => {
      isDisposed = true

      if (battery) {
        battery.removeEventListener('chargingchange', updateBatteryStatus)
        battery.removeEventListener('levelchange', updateBatteryStatus)
      }
    }
  }, [])

  return batteryStatus
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
  const batteryStatus = useBatteryStatus()

  return (
    <section className="home-screen" aria-label="チーム選択">
      <BatteryIndicator status={batteryStatus} />
      <h1 className="home-title">ゲームは続く</h1>
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

type BatteryIndicatorProps = {
  status: BatteryStatus
}

function BatteryIndicator({ status }: BatteryIndicatorProps) {
  const batteryLevel = status.level === null ? 0 : Math.round(status.level * 100)
  const batteryPercent = status.level === null ? '--' : `${batteryLevel}%`
  const batteryLabel = status.supported
    ? status.charging
      ? '充電中'
      : '使用中'
    : '取得不可'
  const isLowBattery = status.supported && !status.charging && status.level !== null && status.level <= 0.2

  return (
    <div
      className="battery-indicator"
      data-charging={status.charging}
      data-low={isLowBattery}
      data-supported={status.supported}
      aria-label={
        status.supported && status.level !== null
          ? `バッテリー残量 ${batteryPercent}、${status.charging ? '充電中' : '充電していません'}`
          : 'バッテリー情報を取得できません'
      }
    >
      <span
        className="battery-icon"
        style={{ '--battery-level': `${batteryLevel}%` } as CSSProperties}
        aria-hidden="true"
      >
        <span className="battery-fill" />
      </span>
      <span className="battery-percent">{batteryPercent}</span>
      <span className="battery-state">{batteryLabel}</span>
    </div>
  )
}

type SceneOneProps = {
  onNext: () => void
}

function SceneOne({ onNext }: SceneOneProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isVideoComplete, setIsVideoComplete] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoProgress, setVideoProgress] = useState(0)

  const toggleVideo = async () => {
    playSound(CLICK_SOUND)

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
      setIsVideoPlaying(false)
      return
    }

    try {
      await videoRef.current?.play()
      setIsVideoPlaying(true)
    } catch {
      setIsVideoPlaying(false)
    }
  }

  const syncVideoProgress = () => {
    const video = videoRef.current

    if (!video) {
      return
    }

    setVideoProgress(video.currentTime)
    setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0)
  }

  const seekVideo = (time: number) => {
    const video = videoRef.current

    setVideoProgress(time)

    if (video) {
      video.currentTime = time
    }
  }

  const seekVideoFromClientX = (track: HTMLElement, clientX: number) => {
    if (!videoDuration) {
      return
    }

    const rect = track.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)

    seekVideo(ratio * videoDuration)
  }

  const videoProgressRatio = videoDuration
    ? Math.min(Math.max(videoProgress / videoDuration, 0), 1)
    : 0

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
        </div>
        <p>
          あのスタッフは君たちを無視したわけではなく、
          <br />
          <strong>記憶を消した</strong>だけなので安心して、
          <br />
          とりあえず私の話を<strong>集中</strong>してほしい。
        </p>
        <p>
          ゲームが始まる前に言ったように
          <br />
          いまこの会場には<strong>大変なこと</strong>が起きているんだ。
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
          aria-label={isVideoPlaying ? '動画を停止' : '動画を再生'}
          onClick={() => void toggleVideo()}
        >
          <video
            ref={videoRef}
            src={publicAsset(`videos/scene-1.mp4?v=${SCENE_ONE_VIDEO_VERSION}`)}
            preload="metadata"
            playsInline
            onLoadedMetadata={syncVideoProgress}
            onTimeUpdate={syncVideoProgress}
            onPlay={() => setIsVideoPlaying(true)}
            onPause={() => setIsVideoPlaying(false)}
            onEnded={() => {
              syncVideoProgress()
              setIsVideoComplete(true)
            }}
          />
          <img
            className="play-mark"
            src={publicAsset('images/play.png')}
            alt=""
            aria-hidden="true"
          />
        </button>
        <div
          className="video-seek"
          role="slider"
          tabIndex={videoDuration ? 0 : -1}
          aria-label="動画の再生位置"
          aria-disabled={!videoDuration}
          aria-valuemin={0}
          aria-valuemax={Math.round(videoDuration)}
          aria-valuenow={Math.round(videoProgress)}
          style={{ '--video-progress': `${videoProgressRatio * 100}%` } as CSSProperties}
          onPointerDown={(event) => {
            if (!videoDuration) {
              return
            }

            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            seekVideoFromClientX(event.currentTarget, event.clientX)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              return
            }

            event.preventDefault()
            seekVideoFromClientX(event.currentTarget, event.clientX)
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
          onKeyDown={(event) => {
            if (!videoDuration) {
              return
            }

            const step = videoDuration / 100

            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              seekVideo(Math.max(videoProgress - step, 0))
            }

            if (event.key === 'ArrowRight') {
              event.preventDefault()
              seekVideo(Math.min(videoProgress + step, videoDuration))
            }
          }}
        >
          <span className="video-seek-track" aria-hidden="true">
            <span className="video-seek-fill" />
            <span className="video-seek-thumb" />
          </span>
        </div>
      </div>
      {isVideoComplete && (
        <button
          className="primary-next scene-one-next"
          type="button"
          onClick={() => {
            playSound(CLICK_SOUND)
            onNext()
          }}
        >
          次へ
        </button>
      )}
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
      <button
        className="back-button scene-two-back"
        type="button"
        onClick={() => {
          playSound(CLICK_SOUND)
          onBack()
        }}
      >
        戻る
      </button>
      <div className="scene-two-content">
        <p>
          さっきのスタッフのおかしい発言は、
          <br />
          楽しんでもらうための<strong>必死の努力</strong>だったんだね。
        </p>
        <p>
          犯人が見張っているので、迂闊な行動はやめて、
          <br />
          とにかく今は<strong>ゲームが続いている</strong>ようにみせよう。
          <br />
          先程の「忘却の一撃」は1時間に1回しか打てないので、
          <br />
          もう使えないんだ…。
        </p>
        <p>
          ただ、このままゲームが終わっても、
          <br />
          この会場にお金があまりないことに気づいた強盗が
          <br />
          結局暴れることにはなるんだよね…。
        </p>
        <p className="scene-two-proposal">
          <span className="scene-two-emphasis">ここで提案！</span>
          君たちが、<strong>犯人を突き止める</strong>ことができたら、
          <br />
          私が<span className="scene-two-emphasis">「改心の一撃」</span>を放してあげる！
        </p>
        <p>
          一緒に渡した紙に<strong>天啓の内容をまとめている</strong>ので、
          <br />
          それを確認しながら強盗が誰か考えてね。
        </p>
        <p>
          「改心の一撃」がフルチャージするのは
          <br />
          ちょうどゲームが終わる瞬間。
          <br />
          <strong>チャンスは1回</strong>だけだよ！
        </p>
      </div>
      <button
        className="primary-next scene-two-next"
        type="button"
        onClick={() => {
          playSound(CLICK_SOUND)
          onNext()
        }}
      >
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
          {photos.map((photo) => {
            const isSelected = selectedPhotoId === photo.id

            return (
              <button
                className="suspect-card"
                data-selected={isSelected}
                key={photo.id}
                type="button"
                onClick={() => {
                  playSound(CLICK_SOUND)
                  onSelect(photo.id)
                }}
              >
                <span className="suspect-number">{photo.id}</span>
                <span className="suspect-label">{photo.label}</span>
                <span className="suspect-frame">
                  <img src={photo.src} alt={photo.label} />
                </span>
                <span className="selection-pointer-slot" aria-hidden="true">
                  {isSelected && (
                    <img
                      className="selection-pointer"
                      src={publicAsset('select.png')}
                      alt=""
                    />
                  )}
                </span>
              </button>
            )
          })}
        </div>

        <div className="selection-area" aria-live="polite">
          {selectedPhoto ? (
            <strong>お前だ！</strong>
          ) : (
            <span className="empty-selection">選択してください</span>
          )}
        </div>

        <button
          className="submit-answer"
          type="button"
          disabled={!selectedPhoto}
          onClick={() => {
            playSound(SUBMIT_SOUND)
            void onSubmit()
          }}
        >
          天使に提出する
        </button>
        <p className="submit-answer-note">※提出後でも選びなおすことができます</p>
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
      <img
        className="submitted-answer-art"
        src={publicAsset('images/goutou.webp')}
        alt=""
        aria-hidden="true"
      />
      <img className="submitted-file-photo" src={photo.src} alt={photo.label} />
      <span className="submitted-file-name">{photo.label}</span>
      <button
        className="retry-answer"
        type="button"
        onClick={() => {
          playSound(CLICK_SOUND)
          onRetry()
        }}
      >
        選び直す
      </button>
    </section>
  )
}

type MasterScreenProps = {
  answerResetAt: number | null
  realtimeConnected: boolean
  realtimeError: string
  teams: TeamState[]
  onBack: () => void
  onResetAnswers: () => void
}

function MasterScreen({
  answerResetAt,
  realtimeConnected,
  realtimeError,
  teams,
  onBack,
  onResetAnswers,
}: MasterScreenProps) {
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)

  const confirmReset = () => {
    onResetAnswers()
    setIsResetConfirmOpen(false)
  }

  return (
    <section className="master-screen" aria-label="MASTER">
      <button className="master-back" type="button" onClick={onBack}>
        戻る
      </button>
      <button
        className="master-reset-answers"
        type="button"
        onClick={() => setIsResetConfirmOpen(true)}
      >
        リセット機能
      </button>
      <h1>MASTER</h1>
      <div className="master-connection" data-connected={realtimeConnected}>
        RTDB {realtimeConnected ? '接続中' : '未接続'}
      </div>
      {realtimeError && <div className="master-error">{realtimeError}</div>}
      <div className="master-url">{realtimeDatabaseUrl}</div>

      <div className="master-team-grid">
        {teams.map((team) => {
          const answer =
            answerResetAt && (!team.answer?.submittedAt || team.answer.submittedAt <= answerResetAt)
              ? undefined
              : team.answer
          const isCorrect = answer?.photoId === 2 || answer?.label === '学芸員'

          return (
            <article className="master-team" key={team.team}>
              <div className="master-team-number" data-alive={isTeamAlive(team)}>
                {team.team}
              </div>
              <div className="master-team-answer" data-correct={isCorrect}>
                {answer?.label ?? ''}
              </div>
            </article>
          )
        })}
      </div>

      {isResetConfirmOpen && (
        <div
          className="master-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="リセット確認"
        >
          <div className="master-confirm-panel">
            <p>回答表示をリセットしますか</p>
            <div className="master-confirm-actions">
              <button type="button" onClick={confirmReset}>
                はい
              </button>
              <button type="button" onClick={() => setIsResetConfirmOpen(false)}>
                いいえ
              </button>
            </div>
          </div>
        </div>
      )}
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
      <img className="photo-qr" src={publicAsset('QR.png')} alt="QRコード" />
      <div className="photo-manager-inner">
        <h1>写真撮影</h1>
        <p>4枚の写真を選ぶと、最終解答の候補画像に反映されます。</p>
        {uploadStatus && <div className="upload-status">{uploadStatus}</div>}
        <div className="photo-editor-list">
          {photos.map((photo) => (
            <article className="photo-editor" key={photo.id}>
              <img src={photo.src} alt={`${photo.label}の現在の写真`} />
              <div>
                <h2>{photo.id}. {photo.label}</h2>
                <p className="photo-updated-at">{formatPhotoUpdatedAt(photo.updatedAt)}</p>
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
