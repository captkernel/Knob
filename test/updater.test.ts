import { describe, it, expect } from 'vitest'
import { mapUpdaterEvent } from '../src/main/updaterMap'

describe('mapUpdaterEvent', () => {
  it('checking-for-update -> checking', () => {
    expect(mapUpdaterEvent('checking-for-update')).toEqual({ state: 'checking' })
  })

  it('update-available -> downloading at 0% with version', () => {
    expect(mapUpdaterEvent('update-available', { version: '1.2.0' })).toEqual({
      state: 'downloading',
      version: '1.2.0',
      percent: 0
    })
  })

  it('update-not-available -> idle', () => {
    expect(mapUpdaterEvent('update-not-available')).toEqual({ state: 'idle' })
  })

  it('download-progress -> downloading with rounded percent', () => {
    expect(mapUpdaterEvent('download-progress', { percent: 42.7 })).toEqual({
      state: 'downloading',
      percent: 43
    })
  })

  it('download-progress with missing percent defaults to 0', () => {
    expect(mapUpdaterEvent('download-progress', {})).toEqual({ state: 'downloading', percent: 0 })
  })

  it('update-downloaded -> ready with version', () => {
    expect(mapUpdaterEvent('update-downloaded', { version: '1.2.0' })).toEqual({
      state: 'ready',
      version: '1.2.0'
    })
  })

  it('error -> error with message', () => {
    expect(mapUpdaterEvent('error', { message: 'boom' })).toEqual({
      state: 'error',
      message: 'boom'
    })
  })

  it('error with no message still returns error state', () => {
    expect(mapUpdaterEvent('error')).toEqual({ state: 'error', message: 'Unknown update error' })
  })
})
