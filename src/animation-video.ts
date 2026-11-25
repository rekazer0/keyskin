/** Read only the packaged video; never attach an externally supplied URL or play audio. */
export async function loadAnimationVideo(bytes: Uint8Array, mime: string, signal: AbortSignal, redraw: () => void): Promise<HTMLVideoElement | undefined> {
  if (signal.aborted) return
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }))
  const dispose = () => {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
  const loaded = await new Promise<boolean>(resolve => {
    video.addEventListener("loadeddata", () => resolve(true), { once: true, signal })
    video.addEventListener("error", () => resolve(false), { once: true, signal })
    signal.addEventListener("abort", () => resolve(false), { once: true })
    video.src = url
  })
  if (!loaded || signal.aborted || !Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
    dispose()
    return
  }
  signal.addEventListener("abort", dispose, { once: true })
  video.addEventListener("seeked", redraw, { signal })
  return video
}
