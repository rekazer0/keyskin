// 粒子：按下与显示动画发射的帧，每帧按自己的旋转、缩放、透明度贴一张图。
import type { Visual } from "../atlas.ts"

export type ParticleFrame = {
  styleID: string
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
}

/** `frames` 里每一帧都用 `styleID` 找到自己的图；找不到或参数退化的跳过。 */
export function paintParticles(
  context: CanvasRenderingContext2D,
  frames: readonly ParticleFrame[],
  visualOf: (styleID: string) => Visual | undefined,
): void {
  for (const frame of frames) {
    const visual = visualOf(frame.styleID)
    if (!visual?.image || !visual.source || frame.scale <= 0 || frame.opacity <= 0) continue
    const [sx, sy, width, height] = visual.source
    context.save()
    context.globalAlpha *= frame.opacity
    context.translate(frame.x, frame.y)
    context.rotate(frame.rotation * Math.PI / 180)
    context.scale(frame.scale, frame.scale)
    context.drawImage(visual.image, sx, sy, width, height, -width / 2, -height / 2, width, height)
    context.restore()
  }
}
