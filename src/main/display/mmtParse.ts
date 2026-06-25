import type { MonitorState } from '@shared/types'
import { parseCsv, toNum, truthy } from '../audio/svclParse'

/** "2560 X 1440" → { width, height }; tolerant of 'x'/spacing. */
function parseResolution(v: string): { width: number; height: number } {
  const m = /(-?\d+)\s*[xX]\s*(-?\d+)/.exec(v ?? '')
  return { width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0 }
}

/** "1920, 0" → { x, y }. */
function parsePosition(v: string): { x: number; y: number } {
  const m = /(-?\d+)\s*,\s*(-?\d+)/.exec(v ?? '')
  return { x: m ? Number(m[1]) : 0, y: m ? Number(m[2]) : 0 }
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k] && row[k] !== '') return row[k]
  return ''
}

/** Friendly label: Monitor String unless empty/generic, else Monitor Name, else fallback. */
function friendlyName(row: Record<string, string>, fallback: string): string {
  const str = pick(row, ['Monitor String'])
  if (str && str.toLowerCase() !== 'generic pnp monitor') return str
  return pick(row, ['Monitor Name', 'Short Monitor ID']) || fallback
}

/** Pure: MultiMonitorTool /scomma CSV → MonitorState[]. Never throws. */
export function parseMonitors(csv: string): MonitorState[] {
  const out: MonitorState[] = []
  for (const row of parseCsv(csv)) {
    if (truthy(pick(row, ['Disconnected']))) continue // not physically present
    const device = pick(row, ['Name']) // \\.\DISPLAYn — the apply command target
    const id = pick(row, ['Short Monitor ID', 'Monitor ID', 'Name']) // stable match key
    if (!id) continue
    const { width, height } = parseResolution(pick(row, ['Resolution']))
    const { x, y } = parsePosition(pick(row, ['Left-Top']))
    const freq = toNum(pick(row, ['Frequency']))
    const refreshHz = freq && freq > 0 ? freq : undefined
    out.push({
      id, device,
      name: friendlyName(row, id),
      enabled: truthy(pick(row, ['Active'])),
      primary: truthy(pick(row, ['Primary'])),
      x, y, width, height,
      ...(refreshHz !== undefined ? { refreshHz } : {})
    })
  }
  return out
}
