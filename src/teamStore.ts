import {
  off,
  onDisconnect,
  onValue,
  remove,
  ref,
  serverTimestamp,
  set,
  update,
} from 'firebase/database'
import { realtimeDb } from './firebase'

export type TeamAnswer = {
  label: string
  photoId: number
  submittedAt?: number
}

export type TeamState = {
  answer?: TeamAnswer
  connections?: Record<string, { connectedAt?: number }>
  online?: boolean
  team: number
}

export type GameControlState = {
  gameEnded: boolean
  updatedAt?: number
}

export type HomeCommandState = {
  id: string
  issuedAt?: number
}

const TEAM_NUMBERS = Array.from({ length: 8 }, (_, index) => index + 1)

function createSessionId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function subscribeRealtimeConnection(onChange: (connected: boolean) => void) {
  return onValue(ref(realtimeDb, '.info/connected'), (snapshot) => {
    onChange(snapshot.val() === true)
  })
}

export function connectTeamPresence(team: number, onError?: (message: string) => void) {
  const connectedRef = ref(realtimeDb, '.info/connected')
  const sessionId = createSessionId()
  const sessionRef = ref(realtimeDb, `teams/${team}/connections/${sessionId}`)

  const unsubscribe = onValue(connectedRef, (snapshot) => {
    if (snapshot.val() !== true) {
      return
    }

    void onDisconnect(sessionRef)
      .remove()
      .then(() =>
        set(sessionRef, {
          connectedAt: serverTimestamp(),
        }),
      )
      .catch((error: unknown) => {
        onError?.(getErrorMessage(error))
      })
  })

  return () => {
    unsubscribe()
    void onDisconnect(sessionRef).cancel().catch(() => undefined)
    void remove(sessionRef).catch(() => undefined)
  }
}

export function subscribeTeamStates(
  onChange: (teams: TeamState[]) => void,
  onError?: (message: string) => void,
) {
  const teamsRef = ref(realtimeDb, 'teams')

  return onValue(
    teamsRef,
    (snapshot) => {
      const value = snapshot.val() as Record<string, Omit<TeamState, 'team'>> | null

      onChange(
        TEAM_NUMBERS.map((team) => {
          const teamValue = value?.[team]
          const connections = teamValue?.connections ?? {}
        const connectionList = Object.values(connections)

          return {
            team,
            ...teamValue,
            online: connectionList.length > 0,
          }
        }),
      )
    },
    (error) => {
      onError?.(error.message)
    },
  )
}

export function submitTeamAnswer(team: number, answer: TeamAnswer) {
  return update(ref(realtimeDb, `teams/${team}/answer`), {
    label: answer.label,
    photoId: answer.photoId,
    submittedAt: serverTimestamp(),
  })
}

export function subscribeTeamAnswer(
  team: number,
  onChange: (answer: TeamAnswer | undefined) => void,
  onError?: (message: string) => void,
) {
  return onValue(
    ref(realtimeDb, `teams/${team}/answer`),
    (snapshot) => {
      onChange((snapshot.val() as TeamAnswer | null) ?? undefined)
    },
    (error) => {
      onError?.(error.message)
    },
  )
}

export function clearTeamAnswer(team: number) {
  return remove(ref(realtimeDb, `teams/${team}/answer`))
}

export function resetAllTeamAnswers() {
  return update(
    ref(realtimeDb),
    Object.fromEntries(TEAM_NUMBERS.map((team) => [`teams/${team}/answer`, null])),
  )
}

export function subscribeGameControl(
  onChange: (state: GameControlState) => void,
  onError?: (message: string) => void,
) {
  return onValue(
    ref(realtimeDb, 'gameControl'),
    (snapshot) => {
      const value = snapshot.val() as Partial<GameControlState> | null

      onChange({
        gameEnded: value?.gameEnded === true,
        updatedAt: value?.updatedAt,
      })
    },
    (error) => {
      onError?.(error.message)
    },
  )
}

export function setGameEndedStatus(gameEnded: boolean) {
  return update(ref(realtimeDb, 'gameControl'), {
    gameEnded,
    updatedAt: serverTimestamp(),
  })
}

export function sendHomeCommand() {
  return update(ref(realtimeDb), {
    'navigationCommand/home': {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      issuedAt: serverTimestamp(),
    },
    ...Object.fromEntries(TEAM_NUMBERS.map((team) => [`teams/${team}/connections`, null])),
  })
}

export function subscribeHomeCommand(
  onChange: (command: HomeCommandState | undefined) => void,
  onError?: (message: string) => void,
) {
  return onValue(
    ref(realtimeDb, 'navigationCommand/home'),
    (snapshot) => {
      onChange((snapshot.val() as HomeCommandState | null) ?? undefined)
    },
    (error) => {
      onError?.(error.message)
    },
  )
}

export function unsubscribeTeamStates() {
  off(ref(realtimeDb, 'teams'))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
