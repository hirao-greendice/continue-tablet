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
  connections?: Record<string, { connectedAt?: number; lastSeen?: number }>
  lastSeen?: number
  online?: boolean
  team: number
}

const TEAM_NUMBERS = Array.from({ length: 8 }, (_, index) => index + 1)
const HEARTBEAT_INTERVAL_MS = 15_000

function createSessionId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function connectTeamPresence(team: number) {
  const connectedRef = ref(realtimeDb, '.info/connected')
  const sessionId = createSessionId()
  const sessionRef = ref(realtimeDb, `teams/${team}/connections/${sessionId}`)
  let heartbeatTimer: number | undefined

  const unsubscribe = onValue(connectedRef, (snapshot) => {
    if (snapshot.val() !== true) {
      return
    }

    void onDisconnect(sessionRef).remove()

    void set(sessionRef, {
      connectedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    })

    window.clearInterval(heartbeatTimer)
    heartbeatTimer = window.setInterval(() => {
      void update(sessionRef, {
        lastSeen: serverTimestamp(),
      })
    }, HEARTBEAT_INTERVAL_MS)
  })

  return () => {
    window.clearInterval(heartbeatTimer)
    unsubscribe()
    void onDisconnect(sessionRef).cancel()
    void remove(sessionRef)
  }
}

export function subscribeTeamStates(onChange: (teams: TeamState[]) => void) {
  const teamsRef = ref(realtimeDb, 'teams')

  return onValue(teamsRef, (snapshot) => {
    const value = snapshot.val() as Record<string, Omit<TeamState, 'team'>> | null

    onChange(
      TEAM_NUMBERS.map((team) => {
        const teamValue = value?.[team]
        const connections = teamValue?.connections ?? {}
        const connectionList = Object.values(connections)
        const lastSeen = connectionList.reduce(
          (latest, connection) => Math.max(latest, connection.lastSeen ?? 0),
          teamValue?.lastSeen ?? 0,
        )

        return {
          team,
          ...teamValue,
          lastSeen,
          online: connectionList.length > 0,
        }
      }),
    )
  })
}

export function submitTeamAnswer(team: number, answer: TeamAnswer) {
  return update(ref(realtimeDb, `teams/${team}/answer`), {
    label: answer.label,
    photoId: answer.photoId,
    submittedAt: serverTimestamp(),
  })
}

export function unsubscribeTeamStates() {
  off(ref(realtimeDb, 'teams'))
}
