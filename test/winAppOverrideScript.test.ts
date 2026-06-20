import { describe, it, expect } from 'vitest'
import { buildClearOverridesScript, POLICY_KEY } from '../src/main/winAppOverrideScript'

describe('buildClearOverridesScript', () => {
  const script = buildClearOverridesScript()

  it('is scoped to the audio PolicyConfig PropertyStore key only', () => {
    expect(script).toContain(POLICY_KEY)
    // Must guard on existence so it is a no-op when the key is absent.
    expect(script).toContain('if (Test-Path $k)')
  })

  it('only deletes entries whose value carries a process path (the HarddiskVolume filter)', () => {
    // The filter is the sole guard against deleting role/system entries.
    expect(script).toContain('Device\\\\HarddiskVolume')
    expect(script).toContain('Where-Object')
    // Deletion is constrained to children matched by the Where-Object pipeline.
    expect(script).toMatch(/Where-Object[\s\S]*Remove-Item \$_\.PSPath/)
  })

  it('never targets the registry root or an unfiltered Remove-Item', () => {
    // Remove-Item must always operate on the piped $_.PSPath, not the key itself.
    expect(script).not.toMatch(/Remove-Item \$k/)
    expect(script).not.toMatch(/Remove-Item -Path/)
  })

  it('honors a custom policy key (used to keep the deletion scoped)', () => {
    const custom = buildClearOverridesScript('HKCU:\\SOFTWARE\\Test\\Key')
    expect(custom).toContain("HKCU:\\SOFTWARE\\Test\\Key")
    expect(custom).not.toContain(POLICY_KEY)
  })
})
