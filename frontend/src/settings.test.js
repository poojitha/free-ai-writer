import { describe, expect, it, vi } from 'vitest'
import {
  ACTIONS,
  IMPROVE_ID,
  SETTINGS_STORAGE_KEY,
  clampSuggestionHeight,
  loadStoredSettings,
  resolveActionPrompt,
  toStoredSettings,
} from './settings.js'

const defaults = {
  host: 'http://localhost:11434',
  model: 'llama3.1:8b',
  prompt: 'default improve',
  actionPrompts: { concise: 'default concise', grammar: 'default grammar' },
}

describe('ACTIONS', () => {
  it('has unique ids and includes the improve action', () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(IMPROVE_ID)
  })
})

describe('loadStoredSettings', () => {
  it('returns null when nothing is stored or the JSON is broken', () => {
    expect(loadStoredSettings()).toBeNull()
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json')
    expect(loadStoredSettings()).toBeNull()
  })

  it('returns the stored object', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ model: 'x' }))
    expect(loadStoredSettings()).toEqual({ model: 'x' })
  })
})

describe('toStoredSettings', () => {
  it('stores only prompts that differ from the defaults', () => {
    const stored = toStoredSettings(
      {
        host: 'h',
        model: 'm',
        prompt: 'default improve',
        actionPrompts: { concise: 'my concise', grammar: 'default grammar' },
      },
      defaults,
    )
    expect(stored).toEqual({ host: 'h', model: 'm', prompt: undefined, actionPrompts: { concise: 'my concise' } })
  })

  it('keeps an edited Enter prompt', () => {
    const stored = toStoredSettings({ host: '', model: '', prompt: 'mine', actionPrompts: {} }, defaults)
    expect(stored.prompt).toBe('mine')
  })

  it('treats a blank prompt as "use the default"', () => {
    const stored = toStoredSettings(
      { host: '', model: '', prompt: '   ', actionPrompts: { concise: '' } },
      defaults,
    )
    expect(stored.prompt).toBeUndefined()
    expect(stored.actionPrompts).toEqual({})
  })
})

describe('resolveActionPrompt', () => {
  it('uses the Enter prompt for the improve action, or "" for the Go default', async () => {
    const getDefaults = vi.fn()
    expect(await resolveActionPrompt(IMPROVE_ID, { prompt: 'mine' }, getDefaults)).toBe('mine')
    expect(await resolveActionPrompt(IMPROVE_ID, {}, getDefaults)).toBe('')
    expect(getDefaults).not.toHaveBeenCalled()
  })

  it("uses the user's override without fetching defaults", async () => {
    const getDefaults = vi.fn()
    const prompt = await resolveActionPrompt('concise', { actionPrompts: { concise: 'mine' } }, getDefaults)
    expect(prompt).toBe('mine')
    expect(getDefaults).not.toHaveBeenCalled()
  })

  it('falls back to the Go default', async () => {
    const getDefaults = vi.fn().mockResolvedValue(defaults)
    expect(await resolveActionPrompt('grammar', {}, getDefaults)).toBe('default grammar')
  })
})

describe('clampSuggestionHeight', () => {
  it('keeps the height between 80px and 60% of the window', () => {
    expect(clampSuggestionHeight(10, 1000)).toBe(80)
    expect(clampSuggestionHeight(300, 1000)).toBe(300)
    expect(clampSuggestionHeight(900, 1000)).toBe(600)
  })
})
