import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

export const realtimeDatabaseUrl =
  import.meta.env.VITE_FIREBASE_DATABASE_URL ||
  'https://continue-game-default-rtdb.asia-southeast1.firebasedatabase.app'

const firebaseConfig = {
  apiKey: 'AIzaSyDwCogYTgY_k4JYM6dTEb2oB1NjqRF0OPg',
  authDomain: 'continue-game.firebaseapp.com',
  databaseURL: realtimeDatabaseUrl,
  projectId: 'continue-game',
  storageBucket: 'continue-game.firebasestorage.app',
  messagingSenderId: '267058650523',
  appId: '1:267058650523:web:e342969ee014929ded153e',
  measurementId: 'G-QP834HFZLE',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const db = getFirestore(firebaseApp)
export const storage = getStorage(firebaseApp)
export const realtimeDb = getDatabase(firebaseApp, realtimeDatabaseUrl)
