import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from './firebase'

export type StoredPhotoHistoryItem = {
  exportSrc?: string
  src: string
  updatedAt?: number
}

export type StoredPhoto = {
  exportSrc?: string
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
