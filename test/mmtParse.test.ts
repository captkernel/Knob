import { describe, it, expect } from 'vitest'
import { parseMonitors } from '../src/main/display/mmtParse'

// Real MultiMonitorTool /scomma header (subset of the 22 columns the parser reads).
const HEADER =
  'Resolution,Left-Top,Active,Disconnected,Primary,Frequency,Name,Monitor ID,Short Monitor ID,Monitor String,Monitor Name'
const CSV = [
  HEADER,
  '2560 X 1440,"0, 0",Yes,No,Yes,59,\\\\.\\DISPLAY1,MONITOR\\GSM772A\\{g}\\0003,GSM772A,Generic PnP Monitor,LG QHD',
  '1366 X 768,"2560, 167",Yes,No,No,60,\\\\.\\DISPLAY2,MONITOR\\AOC1970\\{g}\\0004,AOC1970,AOC 1970W,1970W',
  '1366 X 768,"2560, 0",No,No,No,0,\\\\.\\DISPLAY3,MONITOR\\SDC420A\\{g}\\0002,SDC420A,Lenovo DisplayHDR,ATNA60HS01-0 ',
  '1920 X 1080,"0, 0",No,Yes,No,0,\\\\.\\DISPLAY4,MONITOR\\OLD9\\{g}\\0009,OLD9,Old TV,Old TV'
].join('\n')

describe('parseMonitors', () => {
  it('maps real MMT columns to MonitorState (id=Short Monitor ID, device=Name)', () => {
    const ms = parseMonitors(CSV)
    // DISPLAY4 is Disconnected=Yes → excluded; 3 connected remain.
    expect(ms).toHaveLength(3)
    expect(ms[0]).toMatchObject({
      id: 'GSM772A', device: '\\\\.\\DISPLAY1', name: 'LG QHD',
      enabled: true, primary: true, x: 0, y: 0, width: 2560, height: 1440, refreshHz: 59
    })
  })
  it('uses Monitor String for the name unless it is Generic PnP Monitor', () => {
    const ms = parseMonitors(CSV)
    expect(ms.find((m) => m.id === 'AOC1970')!.name).toBe('AOC 1970W') // Monitor String
    expect(ms.find((m) => m.id === 'GSM772A')!.name).toBe('LG QHD') // falls back to Monitor Name
    expect(ms.find((m) => m.id === 'SDC420A')!.name).toBe('Lenovo DisplayHDR')
  })
  it('marks a disabled monitor (Active=No) and drops its zero frequency', () => {
    const lenovo = parseMonitors(CSV).find((m) => m.id === 'SDC420A')!
    expect(lenovo.enabled).toBe(false)
    expect(lenovo.refreshHz).toBeUndefined()
  })
  it('ignores blank/garbage rows without throwing', () => {
    expect(parseMonitors('')).toEqual([])
    expect(parseMonitors('Resolution,Name\n,')).toEqual([])
  })
})
