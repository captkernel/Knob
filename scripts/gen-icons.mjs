// Generates Knob's icons with zero dependencies (hand-rolled PNG encoder).
// Produces:
//   build/icon.png        256x256  -> electron-builder derives the .ico from this
//   resources/tray-icon.png  32x32 -> system tray
//   resources/tray-icon@2x.png 64x64
//
// Re-runnable: always overwrites. Draws a rounded "deck" tile with a white knob
// dial and an accent indicator. Tweak ACCENT to match the app's default accent.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const ACCENT = [124, 92, 255] // indigo/violet, matches --accent default
const ACCENT_DARK = [70, 48, 168]

// ---- tiny PNG encoder ----------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---- drawing -------------------------------------------------------------
function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
// signed-distance helpers operate in [0..1] unit space, supersampled for AA.
function drawIcon(size) {
  const SS = 4
  const N = size * SS
  const px = new Float64Array(N * N * 4)

  const radius = 0.22 // rounded-rect corner radius (unit)
  const inset = 0.06
  const cx = 0.5
  const cy = 0.5

  function set(x, y, rgb, a) {
    const i = (y * N + x) * 4
    const ia = px[i + 3]
    const na = a + ia * (1 - a)
    if (na <= 0) return
    for (let c = 0; c < 3; c++) px[i + c] = (rgb[c] * a + px[i + c] * ia * (1 - a)) / na
    px[i + 3] = na
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N
      const v = y / N

      // rounded-rect tile (signed distance)
      const halfW = 0.5 - inset
      const dx = Math.abs(u - cx) - (halfW - radius)
      const dy = Math.abs(v - cy) - (halfW - radius)
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius
      const inside = Math.min(Math.max(dx, dy), 0)
      const dist = outside + inside
      const tileA = clamp01(0.5 - dist * N) // ~1px AA edge

      if (tileA > 0) {
        const grad = lerp(ACCENT, ACCENT_DARK, v)
        set(x, y, grad, tileA)
      }

      // knob dial: white ring
      const r = Math.hypot(u - cx, v - cy)
      const ringOuter = 0.235
      const ringInner = 0.16
      const ringA = clamp01((ringOuter - r) * N * 0.5) * clamp01((r - ringInner) * N * 0.5)
      if (ringA > 0) set(x, y, [255, 255, 255], ringA * 0.95)

      // indicator dot near top of dial
      const idx = u - cx
      const idy = v - (cy - 0.135)
      const dotA = clamp01((0.035 - Math.hypot(idx, idy)) * N)
      if (dotA > 0) set(x, y, [255, 255, 255], dotA)
    }
  }

  // downsample SSxSS -> size
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * N + (x * SS + sx)) * 4
          const pa = px[i + 3]
          r += px[i] * pa
          g += px[i + 1] * pa
          b += px[i + 2] * pa
          a += pa
        }
      }
      const n = SS * SS
      const oi = (y * size + x) * 4
      const aa = a / n
      out[oi] = aa > 0 ? Math.round(r / a) : 0
      out[oi + 1] = aa > 0 ? Math.round(g / a) : 0
      out[oi + 2] = aa > 0 ? Math.round(b / a) : 0
      out[oi + 3] = Math.round(aa * 255)
    }
  }
  return encodePNG(size, size, out)
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

// ---- write ---------------------------------------------------------------
mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), drawIcon(256))
writeFileSync(join(root, 'resources', 'tray-icon.png'), drawIcon(32))
writeFileSync(join(root, 'resources', 'tray-icon@2x.png'), drawIcon(64))
console.log('[gen-icons] wrote build/icon.png, resources/tray-icon.png (+@2x) ✓')
