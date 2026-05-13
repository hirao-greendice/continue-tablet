import {
  off,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
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
  lastSeen?: number
  online?: boolean
  team: number
}

const TEAM_NUMBERS = Array.from({ length: 8 }, (_, index) => index + 1)
const HEARTBEAT_INTERVAL_MS = 15_000

export function connectTeamPresence(team: number) {
  const connectedRef = ref(realtimeDb, '.info/connected')
  const teamRef = ref(realtimeDb, `teams/${team}`)
  let heartbeatTimer: number | undefined

  const unsubscribe = onValue(connectedRef, (snapshot) => {
    if (snapshot.val() !== true) {
      return
    }

    void onDisconnect(teamRef).update({
      lastSeen: serverTimestamp(),
      online: false,
    })

    void update(teamRef, {
      lastSeen: serverTimestamp(),
      online: true,
    })

    window.clearInterval(heartbeatTimer)
    heartbeatTimer = window.setInterval(() => {
      void update(teamRef, {
        lastSeen: serverTimestamp(),
        online: true,
      })
    }, HEARTBEAT_INTERVAL_MS)
  })

  return () => {
    window.clearInterval(heartbeatTimer)
    unsubscribe()
    void onDisconnect(teamRef).cancel()
    void update(teamRef, {
      lastSeen: serverTimestamp(),
      online: false,
    })
  }
}

export function subscribeTeamStates(onChange: (teams: TeamState[]) => void) {
  const teamsRef = ref(realtimeDb, 'teams')

  return onValue(teamsRef, (snapshot) => {
    const value = snapshot.val() as Record<string, Omit<TeamState, 'team'>> | null

    onChange(
      TEAM_NUMBERS.map((team) => ({
        team,
        ...(value?.[team] ?? {}),
      })),
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
