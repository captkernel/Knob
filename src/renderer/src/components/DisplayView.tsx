import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import type { ApplyResult, DisplayProfile, DisplaySnapshot, HelperStatus, Settings } from '@shared/types'
import { api } from '../lib/api'
import { LayoutDiagram } from './LayoutDiagram'
import { DisplayProfilesRow } from './DisplayProfilesRow'

export function DisplayView({
  settings,
  onUpdateSettings
}: {
  settings: Settings
  onUpdateSettings: (patch: Partial<Settings>) => void
}): JSX.Element {
  const [snap, setSnap] = useState<DisplaySnapshot | null>(null)
  const [helper, setHelper] = useState<HelperStatus | null>(null)
  const [applyNote, setApplyNote] = useState<string | null>(null)

  useEffect(() => {
    api.ensureDisplayHelper().then(setHelper).catch((e) => console.error('[display]', e))
    api.getDisplaySnapshot().then(setSnap).catch((e) => console.error('[display]', e))

    const offSnap = api.onDisplaySnapshotChanged(setSnap)
    const offHelper = api.onDisplayHelperStatusChanged(setHelper)
    return () => {
      offSnap()
      offHelper()
    }
  }, [])

  const retryHelper = (): void => {
    api.ensureDisplayHelper().then(setHelper).catch((e) => console.error('[display]', e))
  }

  const apply = (p: DisplayProfile): void => {
    api
      .applyDisplay(p.id)
      .then((res: ApplyResult) => {
        if (res.error) {
          setApplyNote(res.error)
        } else if (res.missingIds.length > 0) {
          setApplyNote(`${res.missingIds.length} display(s) in this profile aren't connected`)
        } else {
          setApplyNote(null)
        }
      })
      .catch((e) => {
        console.error('[display]', e)
        setApplyNote('Failed to apply display profile')
      })
  }

  return (
    <div className="flex flex-col gap-3 px-5 pb-5 pt-2">
      {/* Display helper provisioning banner — mirrors the audio helper banner in App.tsx */}
      {helper?.mock && (
        <div className="no-drag">
          {helper.state === 'downloading' ? (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
              <Loader2 size={14} className="shrink-0 animate-spin" />
              Setting up display — downloading the helper…
            </div>
          ) : helper.state === 'unsupported' ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200/90">
              <AlertTriangle size={14} className="shrink-0" />
              Showing sample data — display control needs Windows to manage real monitors.
            </div>
          ) : (
            <button
              onClick={retryHelper}
              className="flex w-full items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-left text-xs text-amber-200/90 transition-colors hover:bg-amber-400/15"
            >
              <Download size={14} className="shrink-0" />
              <span>
                {helper.state === 'failed'
                  ? "Couldn’t download the display helper. Check your connection and tap to retry."
                  : 'These are sample monitors. Tap to install the display helper and control your real displays.'}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Layout diagram */}
      <LayoutDiagram monitors={snap?.monitors ?? []} />

      {/* Display profiles */}
      <DisplayProfilesRow
        profiles={settings.displayProfiles}
        monitors={snap?.monitors ?? []}
        onApply={apply}
        onChange={(next) => onUpdateSettings({ displayProfiles: next })}
      />

      {/* Inline apply note */}
      {applyNote && (
        <p className="px-1 text-xs text-white/45">{applyNote}</p>
      )}
    </div>
  )
}
