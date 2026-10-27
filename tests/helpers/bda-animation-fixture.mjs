import { readFileSync } from 'node:fs'
import { zipSync, unzipSync, strToU8 } from 'fflate'

const join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]))
const varint = (value) => {
  let current = BigInt(value)
  const out = []
  do { const byte = Number(current & 127n); current >>= 7n; out.push(byte | (current ? 128 : 0)) } while (current)
  return Uint8Array.from(out)
}
const integer = (number, value) => join(varint(number * 8), varint(value))
const message = (number, bytes) => join(varint(number * 8 + 2), varint(bytes.length), bytes)
const text = (number, value) => message(number, strToU8(value))
const float = (number, value) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setFloat32(0, value, true)
  return join(varint(number * 8 + 5), bytes)
}
const range = (min, max) => join(integer(1, min), integer(2, max), text(99, 'range-unknown'))
const vector = (x, y) => join(message(1, range(...x)), message(2, range(...y)))
const resource = (name) => join(integer(1, 1), text(2, name), text(99, 'resource-unknown'))
const entry = (number, key, value) => message(number, join(text(1, key), message(2, value), text(99, 'entry-unknown')))
const common = join(integer(1, 2), integer(2, 1), integer(3, 25), integer(4, 1), integer(7, 180), integer(8, 2), text(99, 'effect-unknown'))
const transform = (number, key, from, to, pixel = false) => entry(number, key, join(common, message(pixel ? 9 : 5, from), message(pixel ? 10 : 6, to)))
const binding = (simple, key, event = 1) => message(1, join(integer(1, 0), integer(2, simple), text(4, key), integer(5, event)))

export function bdaAnimationBytes() {
  const frames = [message(5, join(message(1, resource('frame-a')), integer(2, 160))), message(5, join(message(1, resource('frame-b')), integer(2, 240)))]
  const emitterRanges = Array.from({ length: 11 }, (_, index) => message(index + 14, join(float(1, index === 0 ? 1 : 0.5), float(2, index === 0 ? 2 : 0.25), text(99, 'float-range-unknown'))))
  return join(
    entry(1, 'KEY_Q', join(binding(0, 'press'), message(1, join(integer(3, 1), text(4, 'spark'), integer(5, 1))), text(99, 'binding-unknown'))),
    entry(1, 'KEY_W', text(3, 'KEY_Q')),
    entry(3, 'press', join(integer(1, 0), integer(2, 1), integer(3, 0), integer(4, 1), integer(5, 10), message(6, join(integer(1, 2), text(2, 'zoom'))), message(6, join(integer(1, 1), text(2, 'fade'))), text(99, 'group-unknown'))),
    transform(4, 'fade', range(100, 120), range(240, 255)),
    transform(5, 'zoom', vector([80, 90], [80, 90]), vector([100, 110], [100, 110])),
    transform(6, 'move', vector([0, 1], [2, 3]), vector([20, 30], [40, 50]), true),
    transform(7, 'turn', range(0, 10), range(90, 100)),
    entry(8, 'webp', join(integer(1, 2), integer(2, 1), message(3, resource('motion.webp')), integer(4, 1), text(99, 'media-unknown'))),
    entry(9, 'spark', join(integer(1, 2), integer(2, 1), integer(4, 1), ...frames, integer(6, 1), integer(7, 1), text(99, 'sequence-unknown'))),
    entry(10, 'snow', join(integer(3, 2), integer(4, 0), integer(5, 1), float(6, 1.5), integer(7, 8), integer(8, 40), message(12, join(float(1, 0), float(2, 0), float(3, 1), float(4, 1))), message(13, resource('frame-a')), ...emitterRanges, text(99, 'emitter-unknown'))),
    entry(11, 'vector', join(integer(1, 1), integer(2, 1), message(3, resource('motion.json')))),
    integer(12, 1080),
    entry(13, 'movie', join(integer(1, 1), integer(2, 1), message(3, resource('movie.mp4')), message(5, resource('frame-a')))),
    text(101, 'root-unknown'),
  )
}

export function bdaAnimationFixture() {
  const base = unzipSync(new Uint8Array(readFileSync(new URL('../../public/default-template.bda', import.meta.url))))
  const files = { 'Info.txt': base['Info.txt'] }
  const png = base['res/10001.png']
  for (const theme of ['light', 'dark']) {
    for (const [path, bytes] of Object.entries(base)) if (path !== 'Info.txt') files[`${theme}/${path}`] = bytes
    for (const orientation of ['port', 'land']) {
      const prefix = `${theme}/${orientation}/`
      files[`${prefix}animationConfig`] = bdaAnimationBytes()
      files[`${prefix}1animationConfig`] = bdaAnimationBytes()
      files[`${prefix}lightAnimationConfig`] = bdaAnimationBytes()
      for (const name of ['frame-a', 'frame-b']) files[`${prefix}res/${name}.png`] = png
    }
  }
  return zipSync(files)
}
