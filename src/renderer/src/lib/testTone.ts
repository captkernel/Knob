// Play a short test tone routed to a SPECIFIC output device, so the user can
// confirm a device actually makes sound — independent of the system default or
// already-playing streams. Uses Chromium's HTMLMediaElement.setSinkId.

/**
 * Find the audiooutput device whose label best matches `matchTerms`
 * (e.g. ["USB Audio Device", "Speakers"]) and play an ~0.8s tone
 * on it. Returns true if it routed to the matched device, false if it fell back to
 * the system default (device not found / setSinkId unsupported).
 */
export async function playTestTone(matchTerms: string[]): Promise<boolean> {
  const terms = matchTerms.filter(Boolean).map((t) => t.toLowerCase())
  let deviceId: string | undefined
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const outs = devices.filter(
      (d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications'
    )
    const exact = outs.find((d) => terms.length > 0 && terms.every((t) => d.label.toLowerCase().includes(t)))
    const loose = outs.find((d) => terms.some((t) => d.label.toLowerCase().includes(t)))
    deviceId = (exact ?? loose)?.deviceId
  } catch (e) {
    console.error('[testTone] enumerateDevices failed:', e)
  }

  const ctx = new AudioContext()
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 660
    // Fade in/out so there's no click.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.04)
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain).connect(dest)

    const audio = new Audio()
    audio.srcObject = dest.stream
    let routed = false
    if (deviceId && typeof audio.setSinkId === 'function') {
      try {
        await audio.setSinkId(deviceId)
        routed = true
      } catch (e) {
        console.error('[testTone] setSinkId failed:', e)
      }
    }
    await audio.play()
    osc.start()
    await new Promise((r) => setTimeout(r, 750))
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05)
    await new Promise((r) => setTimeout(r, 80))
    osc.stop()
    audio.pause()
    return routed
  } finally {
    await ctx.close().catch(() => {})
  }
}
