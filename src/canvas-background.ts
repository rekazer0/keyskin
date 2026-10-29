export const canvasBackgroundValues = ["glass", "checkerboard", "checkerboard-soft", "checkerboard-panel", "light-gray", "white", "gray", "dark"] as const

export type CanvasBackground = typeof canvasBackgroundValues[number]

export function canvasDeviceValue(background: CanvasBackground): string {
  return `canvas-${background}`
}

export function canvasBackgroundFromDevice(value: string): CanvasBackground | undefined {
  if (!value.startsWith("canvas-")) return
  const background = value.slice("canvas-".length)
  return canvasBackgroundValues.find((candidate) => candidate === background)
}

export function effectiveDeviceValue(value: string): string {
  return value === "canvas" || canvasBackgroundFromDevice(value) ? "canvas" : value
}
