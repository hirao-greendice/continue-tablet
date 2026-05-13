import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from './firebase'

export type StoredPhoto = {
  id: number
  src: string
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
  const photoRef = ref(storage, `photos/current/photo-${slotId}.${extension}`)

  await uploadBytes(photoRef, file, {
    contentType: file.type,
  })

  return getDownloadURL(photoRef)
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
