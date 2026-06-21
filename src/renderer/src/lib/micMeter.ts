// Live input-level meter for a SPECIFIC microphone, so the user can confirm a
// device is actually capturing — independent of the system default. Opens a
// getUserMedia stream on the matched device, runs it through an AnalyserNode, and
// reports a normalized 0..1 level each animation frame.

/**
 * Normalized RMS level (0..1) of an AnalyserNode time-domain byte buffer.
 * getByteTimeDomainData centers samples on 128 (silence); we measure the RMS
 * deviation from 128 and scale by 128. Pure — unit tested.
 */
export function rmsLevel(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < data.length; i++) {
    const dev = (data[i] - 128) / 128
    sumSq += dev * dev
  }
  const rms = Math.sqrt(sumSq / data.length)
  return Math.max(0, Math.min(1, rms))
}

export interface MicMeterHandle {
  stop: () => void
}

interface MicMeterOpts {
  durationMs?: number
  onEnd?: () => void
}

/**
 * Find the audioinput device whose label best matches `matchTerms` and stream a
 * live 0..1 level to `onLevel` until `stop()` or `durationMs` (default 6s) elapses.
 * Tearing down stops the mic tracks and closes the AudioContext. Never throws into
 * the caller — failures are logged and end the meter cleanly.
 */
export function startMicMeter(
  matchTerms: string[],
  onLevel: (level: number) => void,
  opts: MicMeterOpts = {}
): MicMeterHandle {
  const terms = matchTerms.filter(Boolean).map((t) => t.toLowerCase())
  const durationMs = opts.durationMs ?? 6000

  let stopped = false
  let raf = 0
  let endTimer = 0
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (raf) cancelAnimationFrame(raf)
    window.clearTimeout(endTimer)
    stream?.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => {})
    onLevel(0)
    opts.onEnd?.()
  }

  ;(async () => {
    let deviceId: string | undefined
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const ins = devices.filter(
        (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'
      )
      const exact = ins.find((d) => terms.length > 0 && terms.every((t) => d.label.toLowerCase().includes(t)))
      const loose = ins.find((d) => terms.some((t) => d.label.toLowerCase().includes(t)))
      deviceId = (exact ?? loose)?.deviceId
    } catch (e) {
      console.error('[micMeter] enumerateDevices failed:', e)
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      })
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)

      const tick = (): void => {
        if (stopped) return
        analyser.getByteTimeDomainData(buf)
        onLevel(rmsLevel(buf))
        raf = requestAnimationFrame(tick)
      }
      tick()
      endTimer = window.setTimeout(stop, durationMs)
    } catch (e) {
      console.error('[micMeter] getUserMedia failed:', e)
      stop()
    }
  })()

  return { stop }
}
