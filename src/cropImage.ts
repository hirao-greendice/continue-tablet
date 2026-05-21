import type { Area } from 'react-easy-crop'
import { PHOTO_OUTPUT_HEIGHT, PHOTO_OUTPUT_WIDTH } from './photoAspect'

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', reject)
    image.src = src
  })
}

export async function createCroppedPhotoFile(
  imageSrc: string,
  croppedAreaPixels: Area,
  slotId: number,
) {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Could not create canvas context.')
  }

  canvas.width = PHOTO_OUTPUT_WIDTH
  canvas.height = PHOTO_OUTPUT_HEIGHT

  context.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    PHOTO_OUTPUT_WIDTH,
    PHOTO_OUTPUT_HEIGHT,
  )

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not create cropped image.'))
          return
        }

        resolve(new File([blob], `photo-${slotId}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  })
}
