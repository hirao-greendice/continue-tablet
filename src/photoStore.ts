import { doc, getDocFromServer, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from './firebase'

export type StoredPhotoHistoryItem = {
  isKept?: boolean
  src: string
  updatedAt?: number
}

export type StoredPhoto = {
  history?: StoredPhotoHistoryItem[]
  id: number
  src: string
  updatedAt?: number
}

type CurrentPhotosDocument = {
  photos?: StoredPhoto[]
}

const currentPhotosRef = doc(db, 'settings', 'currentPhotos')

export function subscribeCurrentPhotos(onChange: (photos: StoredPhoto[]) => void) {
  return onSnapshot(currentPhotosRef, (snapshot) => {
    const data = snapshot.data() as CurrentPhotosDocument | undefined
    const photos = data?.photos

    if (Array.isArray(photos)) {
      onChange(photos)
    }
  })
}

export async function fetchCurrentPhotos() {
  const snapshot = await getDocFromServer(currentPhotosRef)
  const data = snapshot.data() as CurrentPhotosDocument | undefined
  const photos = data?.photos

  return Array.isArray(photos) ? photos : []
}

export async function uploadCurrentPhoto(slotId: number, file: File) {
  const extension = file.type.split('/')[1] || 'jpg'
  const uploadedAt = Date.now()
  const photoRef = ref(storage, `photos/history/photo-${slotId}-${uploadedAt}.${extension}`)

  await uploadBytes(photoRef, file, {
    contentType: file.type,
  })

  const downloadUrl = await getDownloadURL(photoRef)
  const versionedUrl = new URL(downloadUrl)
  versionedUrl.searchParams.set('v', uploadedAt.toString())

  return versionedUrl.toString()
}

export async function deletePhotoFiles(urls: string[]) {
  const paths = Array.from(new Set(urls))
    .map(getPhotoStoragePath)
    .filter((path): path is string => Boolean(path))

  if (paths.length === 0) {
    return
  }

  const results = await Promise.allSettled(
    paths.map((path) => deleteObject(ref(storage, path))),
  )
  const failedResults = results.filter((result) => result.status === 'rejected')

  if (failedResults.length > 0) {
    console.warn('Failed to delete old photo files', failedResults)
  }
}

export async function saveCurrentPhotos(photos: StoredPhoto[]) {
  await setDoc(
    currentPhotosRef,
    {
      photos,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

function getPhotoStoragePath(src: string) {
  try {
    const url = new URL(src)
    const objectPrefix = '/o/'
    const objectStart = url.pathname.indexOf(objectPrefix)

    if (objectStart === -1) {
      return null
    }

    const path = decodeURIComponent(url.pathname.slice(objectStart + objectPrefix.length))

    return path.startsWith('photos/history/') ? path : null
  } catch {
    return null
  }
}
