import { describe, it, expect } from 'vitest'
import { validateArrangement, planApply } from '../src/main/display/displayPlan'
import type { MonitorState } from '../src/shared/types'

// device deliberately differs from id, so tests prove commands target `device`.
const m = (id: string, o: Partial<MonitorState> = {}): MonitorState => ({
  id, device: `dev-${id}`, name: id, enabled: true, primary: false,
  x: 0, y: 0, width: 1920, height: 1080, ...o
})

describe('validateArrangement', () => {
  it('rejects all-disabled', () => {
    expect(validateArrangement([m('a', { enabled: false })])).toMatch(/enabled/i)
  })
  it('rejects zero or multiple primaries among enabled', () => {
    expect(validateArrangement([m('a')])).toMatch(/primary/i)
    expect(validateArrangement([m('a', { primary: true }), m('b', { primary: true })])).toMatch(/primary/i)
  })
  it('accepts exactly one enabled primary', () => {
    expect(validateArrangement([m('a', { primary: true }), m('b')])).toBeNull()
  })
})

describe('planApply', () => {
  it('skips missing monitors and reports them', () => {
    const target = [m('a', { primary: true }), m('gone', { x: 1920 })]
    const { missingIds } = planApply(target, [m('a')])
    expect(missingIds).toEqual(['gone'])
  })
  it('refuses when every present monitor would be disabled', () => {
    const { error, commands } = planApply([m('a', { enabled: false })], [m('a')])
    expect(error).toMatch(/turn off every/i)
    expect(commands).toEqual([])
  })
  it('promotes a primary when the captured primary is disconnected', () => {
    const target = [m('p', { primary: true }), m('b', { x: 1920 })]
    const { commands } = planApply(target, [m('b')])
    const setMon = commands.find((c) => c[0] === '/SetMonitors')!
    expect(setMon.some((a) => /SetAsPrimary=1/.test(a))).toBe(true)
  })
  it('targets the connected device, even if the target stored a stale one', () => {
    // target 'a' stored device 'dev-OLD'; connected reports 'dev-NEW'.
    const target = [{ ...m('a', { primary: true }), device: 'dev-OLD' }]
    const { commands } = planApply(target, [{ ...m('a'), device: 'dev-NEW' }])
    const setMon = commands.find((c) => c[0] === '/SetMonitors')!
    expect(setMon.some((a) => a.startsWith('Name=dev-NEW'))).toBe(true)
    expect(commands).toContainEqual(['/enable', 'dev-NEW'])
  })
  it('builds enable, SetMonitors (position+primary), and disable commands by device', () => {
    const target = [
      m('a', { primary: true, x: 0 }),
      m('b', { x: 2560 }),
      m('c', { enabled: false })
    ]
    const { commands } = planApply(target, [m('a'), m('b'), m('c')])
    expect(commands).toContainEqual(['/enable', 'dev-a'])
    expect(commands).toContainEqual(['/enable', 'dev-b'])
    expect(commands).toContainEqual(['/disable', 'dev-c'])
    const setMon = commands.find((c) => c[0] === '/SetMonitors')!
    expect(setMon).toContain('Name=dev-a PositionX=0 PositionY=0 SetAsPrimary=1')
    expect(setMon).toContain('Name=dev-b PositionX=2560 PositionY=0')
  })
  it('collapses multiple primaries to exactly one SetAsPrimary', () => {
    const target = [m('a', { primary: true }), m('b', { primary: true, x: 1920 })]
    const { commands } = planApply(target, [m('a'), m('b')])
    const setMon = commands.find((c) => c[0] === '/SetMonitors')!
    const primaryBlocks = setMon.filter((a) => /SetAsPrimary=1/.test(a))
    expect(primaryBlocks).toHaveLength(1)
  })
})
