import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
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
  PHOTO_ASPECT_HEIGHT,
  PHOTO_ASPECT_RATIO,
  PHOTO_ASPECT_WIDTH,
} from './photoAspect'
import {
  clearTeamAnswer,
  connectTeamPresence,
  resetAllTeamAnswers,
  setGameEndedStatus,
  subscribeGameControl,
  subscribeRealtimeConnection,
  subscribeTeamAnswer,
  submitTeamAnswer,
  subscribeTeamStates,
  type TeamState,
} from './teamStore'
import { realtimeDatabaseUrl } from './firebase'

type Screen = 'home' | 'scene1' | 'scene3' | 'photos' | 'master'
type DeviceRole = 'unknown' | 'master' | 'player'
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

function versionedAsset(path: string, version: string) {
  const separator = path.includes('?') ? '&' : '?'

  return publicAsset(`${path}${separator}v=${version}`)
}

const SCENE_ONE_VIDEO_VERSION = 'scene-1-20260527-1'
const STATIC_IMAGE_VERSION = 'images-20260527-1'
const CLICK_SOUND = 'sounds/click.mp3'
const SUBMIT_SOUND = 'sounds/omaeda.mp3'
const CLICK_SOUND_VOLUME = 0.8
const SUBMIT_SOUND_VOLUME = 0.6
const SCENE_ONE_VIDEO_VOLUME = 1

function clampVolume(volume: number) {
  return Math.min(Math.max(volume, 0), 1)
}

function playSound(path: string, volume = 1) {
  const sound = new Audio(publicAsset(path))
  sound.volume = clampVolume(volume)
  void sound.play().catch(() => undefined)
}

const SUSPECT_LABELS: Record<number, string> = {
  1: '雑用係\nウーラー・カーター役',
  2: '学芸員\nキャン・バス役',
  3: '警備員\nカンシーガ・シーメイ役',
  4: '刑事\nケージー・ノカン役',
}

const defaultPhotos: PhotoSlot[] = [
  { id: 1, label: SUSPECT_LABELS[1], src: publicAsset('photos/team-photo-1.jpg') },
  { id: 2, label: SUSPECT_LABELS[2], src: publicAsset('photos/team-photo-2.jpg') },
  { id: 3, label: SUSPECT_LABELS[3], src: publicAsset('photos/team-photo-3.jpg') },
  { id: 4, label: SUSPECT_LABELS[4], src: publicAsset('photos/team-photo-4.jpg') },
]

const STAGE_WIDTH = 1200
const STAGE_HEIGHT = 1920
const SCENE_FOLLOWUP_SCROLL_DURATION_MS = 1200
const SCENE_FOLLOWUP_SCROLL_OFFSET = -80
const DEVICE_ROLE_STORAGE_KEY = 'continue-tablet-device-role'

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

function scrollToElement(container: HTMLElement, target: HTMLElement, duration: number) {
  const startTop = container.scrollTop
  const targetTop = Math.max(target.offsetTop + SCENE_FOLLOWUP_SCROLL_OFFSET, 0)
  const distance = targetTop - startTop
  const startTime = performance.now()
  let frameId = 0

  const easeInOutCubic = (progress: number) =>
    progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2

  const animate = (time: number) => {
    const progress = Math.min((time - startTime) / duration, 1)

    container.scrollTop = startTop + distance * easeInOutCubic(progress)

    if (progress < 1) {
      frameId = window.requestAnimationFrame(animate)
    }
  }

  frameId = window.requestAnimationFrame(animate)

  return () => window.cancelAnimationFrame(frameId)
}

function getIsFullscreen() {
  return Boolean(document.fullscreenElement)
}

function getStageScale() {
  return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
}

function getStoredDeviceRole(): DeviceRole {
  const storedRole = window.localStorage.getItem(DEVICE_ROLE_STORAGE_KEY)

  return storedRole === 'master' || storedRole === 'player' ? storedRole : 'unknown'
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(getStoredDeviceRole)
  const [teamNumber, setTeamNumber] = useState<number | null>(null)
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null)
  const [submittedPhotoId, setSubmittedPhotoId] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(getIsFullscreen)
  const [stageScale, setStageScale] = useState(getStageScale)
  const [photos, setPhotos] = useState<PhotoSlot[]>(defaultPhotos)
  const [teamStates, setTeamStates] = useState<TeamState[]>(createEmptyTeamStates)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [realtimeError, setRealtimeError] = useState('')
  const [gameEnded, setGameEnded] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [hasCompletedSceneOneVideo, setHasCompletedSceneOneVideo] = useState(false)
  const [secretMenuOpen, setSecretMenuOpen] = useState(false)
  const preloadedPhotoImages = useRef<Map<string, HTMLImageElement>>(new Map())
  const sceneSequenceRef = useRef<HTMLDivElement>(null)
  const sceneTwoPanelRef = useRef<HTMLDivElement>(null)
  const shouldScrollToSceneTwoRef = useRef(false)
  const sceneTouchScrollRef = useRef({
    animationFrame: 0,
    didDrag: false,
    lastTime: 0,
    lastY: 0,
    suppressClick: false,
    startScrollTop: 0,
    startY: 0,
    velocity: 0,
  })
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
    return subscribeGameControl((state) => setGameEnded(state.gameEnded), setRealtimeError)
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
    if (!teamNumber) {
      return
    }

    return subscribeTeamAnswer(
      teamNumber,
      (answer) => {
        if (!answer) {
          return
        }

        setSubmittedPhotoId(answer.photoId)
        setSelectedPhotoId(answer.photoId)
      },
      setRealtimeError,
    )
  }, [teamNumber])

  useEffect(() => {
    if (screen !== 'home' && screen !== 'scene1') {
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

  useEffect(() => {
    if (screen !== 'scene1') {
      return
    }

    if (!hasCompletedSceneOneVideo) {
      sceneSequenceRef.current?.scrollTo({ top: 0 })
      return
    }

    if (!shouldScrollToSceneTwoRef.current) {
      sceneSequenceRef.current?.scrollTo({ top: 0 })
      return
    }

    shouldScrollToSceneTwoRef.current = false

    let cancelScroll: (() => void) | undefined
    const frameId = window.requestAnimationFrame(() => {
      if (sceneSequenceRef.current && sceneTwoPanelRef.current) {
        cancelScroll = scrollToElement(
          sceneSequenceRef.current,
          sceneTwoPanelRef.current,
          SCENE_FOLLOWUP_SCROLL_DURATION_MS,
        )
      }
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      cancelScroll?.()
    }
  }, [hasCompletedSceneOneVideo, screen])

  useEffect(() => {
    if (screen !== 'scene1' || !hasCompletedSceneOneVideo) {
      return
    }

    const scrollContainer = sceneSequenceRef.current

    if (!scrollContainer) {
      return
    }

    const shouldIgnoreTouch = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('.video-seek'))

    const getMaxScrollTop = () =>
      Math.max(scrollContainer.scrollHeight - scrollContainer.clientHeight, 0)

    const scrollToTop = (top: number) => {
      scrollContainer.scrollTop = Math.min(Math.max(top, 0), getMaxScrollTop())
    }

    const stopMomentum = () => {
      if (sceneTouchScrollRef.current.animationFrame) {
        window.cancelAnimationFrame(sceneTouchScrollRef.current.animationFrame)
        sceneTouchScrollRef.current.animationFrame = 0
      }
    }

    const runMomentum = () => {
      const state = sceneTouchScrollRef.current

      if (Math.abs(state.velocity) < 0.02) {
        state.animationFrame = 0
        return
      }

      const beforeTop = scrollContainer.scrollTop
      scrollToTop(beforeTop + state.velocity * 16)

      if (scrollContainer.scrollTop === beforeTop) {
        state.animationFrame = 0
        state.velocity = 0
        return
      }

      state.velocity *= 0.92
      state.animationFrame = window.requestAnimationFrame(runMomentum)
    }

    const startTouchScroll = (event: TouchEvent) => {
      if (shouldIgnoreTouch(event.target) || event.touches.length !== 1) {
        return
      }

      stopMomentum()

      const touchY = event.touches[0].clientY
      const now = performance.now()

      sceneTouchScrollRef.current = {
        animationFrame: 0,
        didDrag: false,
        lastTime: now,
        lastY: touchY,
        suppressClick: false,
        startScrollTop: scrollContainer.scrollTop,
        startY: touchY,
        velocity: 0,
      }
    }

    const moveTouchScroll = (event: TouchEvent) => {
      if (shouldIgnoreTouch(event.target) || event.touches.length !== 1) {
        return
      }

      const state = sceneTouchScrollRef.current
      const touchY = event.touches[0].clientY
      const deltaFromStart = touchY - state.startY

      if (Math.abs(deltaFromStart) < 5 && !state.didDrag) {
        return
      }

      const now = performance.now()
      const deltaY = touchY - state.lastY
      const deltaTime = Math.max(now - state.lastTime, 1)
      const scrollDelta = -deltaY / Math.max(stageScale, 0.1)

      state.didDrag = true
      state.suppressClick = true
      state.velocity = Math.min(Math.max(scrollDelta / deltaTime, -4), 4)
      state.lastY = touchY
      state.lastTime = now

      scrollToTop(scrollContainer.scrollTop + scrollDelta)
      event.preventDefault()
    }

    const endTouchScroll = () => {
      const state = sceneTouchScrollRef.current

      if (!state.didDrag) {
        return
      }

      stopMomentum()
      state.animationFrame = window.requestAnimationFrame(runMomentum)
    }

    const suppressDraggedClick = (event: MouseEvent) => {
      const state = sceneTouchScrollRef.current

      if (!state.suppressClick) {
        return
      }

      state.suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    const wheelScroll = (event: WheelEvent) => {
      if (shouldIgnoreTouch(event.target)) {
        return
      }

      scrollToTop(scrollContainer.scrollTop + event.deltaY / Math.max(stageScale, 0.1))
      event.preventDefault()
    }

    scrollContainer.addEventListener('touchstart', startTouchScroll, { passive: true })
    scrollContainer.addEventListener('touchmove', moveTouchScroll, { passive: false })
    scrollContainer.addEventListener('touchend', endTouchScroll)
    scrollContainer.addEventListener('touchcancel', endTouchScroll)
    scrollContainer.addEventListener('click', suppressDraggedClick, true)
    scrollContainer.addEventListener('wheel', wheelScroll, { passive: false })

    return () => {
      stopMomentum()
      scrollContainer.removeEventListener('touchstart', startTouchScroll)
      scrollContainer.removeEventListener('touchmove', moveTouchScroll)
      scrollContainer.removeEventListener('touchend', endTouchScroll)
      scrollContainer.removeEventListener('touchcancel', endTouchScroll)
      scrollContainer.removeEventListener('click', suppressDraggedClick, true)
      scrollContainer.removeEventListener('wheel', wheelScroll)
    }
  }, [hasCompletedSceneOneVideo, screen, stageScale])

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
    setDeviceRole('player')
    window.localStorage.setItem(DEVICE_ROLE_STORAGE_KEY, 'player')
    setTeamNumber(team)
    setSelectedPhotoId(null)
    setSubmittedPhotoId(null)
    shouldScrollToSceneTwoRef.current = false
    setHasCompletedSceneOneVideo(false)
    setScreen('scene1')
  }

  const goHome = () => {
    setTeamNumber(null)
    setSelectedPhotoId(null)
    setSubmittedPhotoId(null)
    shouldScrollToSceneTwoRef.current = false
    setHasCompletedSceneOneVideo(false)
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

  const retryAnswer = async () => {
    if (teamNumber) {
      await clearTeamAnswer(teamNumber)
    }

    setSubmittedPhotoId(null)
    setSelectedPhotoId(null)
  }

  const resetMasterAnswers = async () => {
    await resetAllTeamAnswers()
  }

  const returnToSceneTwo = () => {
    shouldScrollToSceneTwoRef.current = false
    setHasCompletedSceneOneVideo(true)
    setScreen('scene1')
  }

  const completeSceneOneVideo = () => {
    shouldScrollToSceneTwoRef.current = true
    setHasCompletedSceneOneVideo(true)
  }

  const openMaster = () => {
    setDeviceRole('master')
    window.localStorage.setItem(DEVICE_ROLE_STORAGE_KEY, 'master')
    setScreen('master')
  }

  const openPhotos = () => {
    setDeviceRole('master')
    window.localStorage.setItem(DEVICE_ROLE_STORAGE_KEY, 'master')
    setScreen('photos')
  }

  const isPlayerGameEnded =
    gameEnded &&
    deviceRole === 'player' &&
    (screen === 'scene1' || screen === 'scene3')

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
            '--photo-aspect-width': `${PHOTO_ASPECT_WIDTH}`,
            '--photo-aspect-height': `${PHOTO_ASPECT_HEIGHT}`,
            '--photo-aspect-ratio': `${PHOTO_ASPECT_RATIO}`,
          } as CSSProperties
        }
      >
        <div className="stage-content">
          {screen === 'home' && (
            <HomeScreen
              photos={photos}
              onStartTeam={startTeam}
              onOpenMaster={openMaster}
              onOpenPhotos={openPhotos}
            />
          )}

          {screen === 'scene1' && (
            <div
              className="scene-sequence"
              data-followup-visible={hasCompletedSceneOneVideo}
              ref={sceneSequenceRef}
            >
              <SceneOne
                isVideoComplete={hasCompletedSceneOneVideo}
                sceneFollowupRef={sceneTwoPanelRef}
                onVideoComplete={completeSceneOneVideo}
                onNext={() => setScreen('scene3')}
              />
            </div>
          )}

          {screen === 'scene3' && (
            <SceneThree
              photos={photos}
              selectedPhoto={selectedPhoto}
              selectedPhotoId={selectedPhotoId}
              submittedPhoto={submittedPhoto}
              onBack={returnToSceneTwo}
              onRetry={retryAnswer}
              onSelect={setSelectedPhotoId}
              onSubmit={submitAnswer}
            />
          )}

          {screen === 'master' && (
            <MasterScreen
              gameEnded={gameEnded}
              realtimeConnected={realtimeConnected}
              realtimeError={realtimeError}
              teams={teamStates}
              onBack={() => setScreen('home')}
              onResetAnswers={resetMasterAnswers}
              onSetGameEnded={setGameEndedStatus}
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

      {isPlayerGameEnded && <GameEndedOverlay />}

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

function GameEndedOverlay() {
  return (
    <div className="game-ended-overlay" role="status" aria-live="polite">
      <div className="game-ended-message">ゲームが終了いたしました</div>
    </div>
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

function formatHomePhotoUpdatedAt(updatedAt: number | undefined) {
  if (!updatedAt) {
    return '未更新'
  }

  return photoUpdatedAtFormatter.format(new Date(updatedAt))
}

function createEmptyTeamStates() {
  return Array.from({ length: 8 }, (_, index) => ({ team: index + 1 }))
}

function getAnswerLabel(photoId: number) {
  return SUSPECT_LABELS[photoId] ?? ''
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
            <span>{photo.label}</span>
            <p className="home-photo-updated-at">{formatHomePhotoUpdatedAt(photo.updatedAt)}</p>
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
  isVideoComplete: boolean
  sceneFollowupRef: RefObject<HTMLDivElement | null>
  onVideoComplete: () => void
  onNext: () => void
}

function SceneOne({
  isVideoComplete,
  sceneFollowupRef,
  onVideoComplete,
  onNext,
}: SceneOneProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasStartedVideo, setHasStartedVideo] = useState(false)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoProgress, setVideoProgress] = useState(0)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = clampVolume(SCENE_ONE_VIDEO_VOLUME)
    }
  }, [])

  const toggleVideo = async () => {
    playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
      setIsVideoPlaying(false)
      return
    }

    try {
      if (videoRef.current) {
        videoRef.current.volume = clampVolume(SCENE_ONE_VIDEO_VOLUME)
      }

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
        style={{ backgroundImage: `url("${versionedAsset('images/scene-parchment-bg.svg', STATIC_IMAGE_VERSION)}")` }}
        aria-hidden="true"
      />
      <div className="scene-one-content">
        <div className="ribbon-title">
          <img
            className="ribbon-title-art"
            src={versionedAsset('images/dayo.png', STATIC_IMAGE_VERSION)}
            alt=""
            aria-hidden="true"
          />
          <h1>天啓だよ！</h1>
        </div>
        <div className="scene-one-text-panel">
          <p>
            あのスタッフは急におかしくなったのではなく、
            <br />
            <strong>ボクが少し取り憑かせてもらっただけなので、</strong>
            <br />
            安心してボクの天啓を聞いてほしい。
          </p>
          <p>
            ボクは<strong className="scene-alert-emphasis">天使</strong>。
            <br />
            運命が狂ってしまった人間を助ける使者だよ。
          </p>
          <p>
            君たちが遊んでいる<br />「幻の秘宝コバルト・ハートの消失」<br />というナゾトキイベントでは、<br />いつもとは違う、<br /><strong>大変なこと</strong>が起こっているんだ。
          </p>
          <p>
            文字で説明するより見せたほうがいいか。
            <br />
            君たちがこの会場に入る前にボクがみた光景を、
            <br />
            なるべく<strong>リアルに再現</strong>するね。
          </p>
        </div>
        <button
          className="video-box"
          data-playing={isVideoPlaying}
          data-started={hasStartedVideo}
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
            onPlay={() => {
              setHasStartedVideo(true)
              setIsVideoPlaying(true)
            }}
            onPause={() => setIsVideoPlaying(false)}
            onEnded={() => {
              syncVideoProgress()
              onVideoComplete()
            }}
          />
          <img
            className="play-mark"
            src={versionedAsset('images/play.png', STATIC_IMAGE_VERSION)}
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
        {isVideoComplete && (
          <div className="scene-one-followup" ref={sceneFollowupRef}>
            <SceneTwoContent onNext={onNext} />
          </div>
        )}
      </div>
    </section>
  )
}

type SceneTwoProps = {
  onNext: () => void
}

function SceneTwoContent({ onNext }: SceneTwoProps) {
  return (
    <>
      <div className="scene-two-content">
        <div className="scene-two-text-block">
          <p>
            先ほどの<strong>はりきった</strong>という<strong>シーメイ</strong>の発言は、
            <br />
            君たちに楽しんでもらうための
            <br />
            <strong>必死の努力のアピール</strong>だったのかもね。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            とにかく今この<strong>会場にいる泥棒</strong>によって
            <br />
            君たちは<strong className="scene-alert-emphasis scene-fate-emphasis">死ぬ運命</strong>にある。
            <br />
            ゲームが終わったあとの解説で、
            <br />
            スタッフが変な細工をしたことに
            <br />
            気づいてしまうんだよね。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            誰が泥棒なのか教えてあげたいけど、
            <br />
            天使の掟で<strong>「人の運命を直接変える」</strong>ことは
            <br />
            <strong className="scene-alert-emphasis">禁止</strong>されているんだ。
          </p>
          <p>
            ただ、安心して。
            <br />
            あくまで禁止されているのは<strong>「直接変えること」</strong>。
          </p>
          <p>
            さっき神様と交渉して、君たちが助かる方法を見つけてきたよ。
            <br />
            それは、ボクが泥棒に<strong>「改心の一撃」</strong>を放つこと！
            <br />
            そのためには、
            <br />
            <strong className="scene-two-insight scene-breakthrough-emphasis">君たちのひらめきで泥棒を突き止める</strong>
            <br />
            必要がある。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            さっきの注意事項を聞いて
            <br />
            「謎を独り占めしたら、
            <br />
            退席して死の運命を回避できるじゃん！」
            <br />
            って思った人、いるでしょ？
            <br />
            <strong>そんな方法では無理</strong>！
            <br />
            チームメイトと仲良く協力して、
            <br />
            エレガントに死の運命を回避してね。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            「改心の一撃」が打てるのは
            <br />
            ちょうど<strong>ゲームが終わる瞬間</strong>。
            <br />
            <strong>チャンスは1回</strong>だけだよ！
          </p>
        </div>
      </div>
      <button
        className="primary-next scene-two-next"
        type="button"
        onClick={() => {
          playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
          onNext()
        }}
      >
        <img
          className="scene-two-next-art"
          src={versionedAsset('images/tukitome.png', STATIC_IMAGE_VERSION)}
          alt=""
          aria-hidden="true"
        />
        犯人が誰か突き止める
      </button>
    </>
  )
}

type SceneThreeProps = {
  photos: PhotoSlot[]
  selectedPhoto: PhotoSlot | undefined
  selectedPhotoId: number | null
  submittedPhoto: PhotoSlot | undefined
  onBack: () => void
  onRetry: () => Promise<void>
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
        style={{ backgroundImage: `url("${versionedAsset('images/hannnin.jpg', STATIC_IMAGE_VERSION)}")` }}
        aria-hidden="true"
      />
      <header className="answer-header">
        <button className="back-button answer-back" type="button" onClick={onBack}>
          <img
            className="answer-back-art"
            src={versionedAsset('images/back.webp', STATIC_IMAGE_VERSION)}
            alt=""
            aria-hidden="true"
          />
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
                  playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
                  onSelect(photo.id)
                }}
              >
                <span className="suspect-frame">
                  <img src={photo.src} alt={photo.label} />
                </span>
                <span className="selection-pointer-slot" aria-hidden="true">
                  {isSelected && (
                    <img
                      className="selection-pointer"
                      src={versionedAsset('select.png', STATIC_IMAGE_VERSION)}
                      alt=""
                    />
                  )}
                </span>
                <span className="suspect-label">{photo.label}</span>
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
          aria-label="提出する"
          disabled={!selectedPhoto}
          onClick={() => {
            playSound(SUBMIT_SOUND, SUBMIT_SOUND_VOLUME)
            void onSubmit()
          }}
        >
          <img
            className="image-button-art"
            src={versionedAsset('images/teisyutu_botton.png', STATIC_IMAGE_VERSION)}
            alt=""
            aria-hidden="true"
          />
          天使に提出する
        </button>
        <p className="submit-answer-note">※提出後でも選びなおすことができます</p>
      </div>
    </section>
  )
}

type SubmittedAnswerScreenProps = {
  photo: PhotoSlot
  onRetry: () => Promise<void>
}

function SubmittedAnswerScreen({ photo, onRetry }: SubmittedAnswerScreenProps) {
  return (
    <section className="submitted-answer-screen" aria-label="提出した回答">
      <img
        className="submitted-answer-art"
        src={versionedAsset('images/goutou.jpeg', STATIC_IMAGE_VERSION)}
        alt=""
        aria-hidden="true"
      />
      <span className="submitted-file-photo-frame">
        <img className="submitted-file-photo" src={photo.src} alt={photo.label} />
      </span>
      <span className="submitted-file-name">{photo.label}</span>
      <button
        className="retry-answer"
        type="button"
        aria-label="選び直す"
        onClick={() => {
          playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
          void onRetry()
        }}
      >
        <img
          className="image-button-art"
          src={versionedAsset('images/erabinaosu_button.png', STATIC_IMAGE_VERSION)}
          alt=""
          aria-hidden="true"
        />
        選び直す
      </button>
    </section>
  )
}

type MasterScreenProps = {
  gameEnded: boolean
  realtimeConnected: boolean
  realtimeError: string
  teams: TeamState[]
  onBack: () => void
  onResetAnswers: () => Promise<void>
  onSetGameEnded: (gameEnded: boolean) => Promise<void>
}

function MasterScreen({
  gameEnded,
  realtimeConnected,
  realtimeError,
  teams,
  onBack,
  onResetAnswers,
  onSetGameEnded,
}: MasterScreenProps) {
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)

  const confirmReset = async () => {
    await onResetAnswers()
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
      <div className="master-game-controls">
        <div className="master-game-buttons">
          <button
            className="master-game-end"
            data-active={gameEnded}
            type="button"
            onClick={() => void onSetGameEnded(true)}
          >
            ゲーム終了
          </button>
          <button
            className="master-game-resume"
            data-active={!gameEnded}
            type="button"
            onClick={() => void onSetGameEnded(false)}
          >
            解除
          </button>
        </div>
        <div className="master-game-current-status">
          現在：{gameEnded ? 'ゲーム終了' : 'ゲーム中'}
        </div>
      </div>
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
            <p>全プレイヤーの選択した結果をリセットしますか？</p>
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
      <img
        className="photo-qr"
        src={versionedAsset('QR.png', STATIC_IMAGE_VERSION)}
        alt="QRコード"
      />
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
            aspect={PHOTO_ASPECT_RATIO}
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
