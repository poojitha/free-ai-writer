import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  DEFAULT_PROMPTS,
  IMPROVE_ID,
  PROVIDERS,
  SETTINGS_STORAGE_KEY,
  activeAIConfig,
  clampSuggestionHeight,
  loadStoredSettings,
  providerFields,
  resolveActionPrompt,
  toStoredSettings,
} from './settings.js'

const defaults = {
  providers: {
    ollama: { host: 'http://localhost:11434', model: 'qwen2.5:3b' },
    openai: { host: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
    anthropic: { host: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
  },
}

describe('ACTIONS', () => {
  it('has unique ids and includes the improve action', () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(IMPROVE_ID)
  })

  it('gives every action a default prompt', () => {
    for (const a of ACTIONS) expect(a.prompt.trim()).not.toBe('')
    expect(DEFAULT_PROMPTS.prompt).toBe(ACTIONS.find((a) => a.id === IMPROVE_ID).prompt)
    expect(Object.keys(DEFAULT_PROMPTS.actionPrompts)).toEqual(ACTIONS.map((a) => a.id).filter((id) => id !== IMPROVE_ID))
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
        provider: 'openai',
        providers: { openai: { host: 'h', model: 'm', apiKey: 'k' } },
        prompt: DEFAULT_PROMPTS.prompt,
        actionPrompts: { concise: 'my concise', grammar: DEFAULT_PROMPTS.actionPrompts.grammar },
      },
    )
    expect(stored).toEqual({
      provider: 'openai',
      providers: { openai: { host: 'h', model: 'm', apiKey: 'k' } },
      prompt: undefined,
      actionPrompts: { concise: 'my concise' },
    })
  })

  it('keeps an edited Enter prompt', () => {
    const stored = toStoredSettings({ provider: 'ollama', providers: {}, prompt: 'mine', actionPrompts: {} })
    expect(stored.prompt).toBe('mine')
  })

  it('treats a blank prompt as "use the default"', () => {
    const stored = toStoredSettings(
      { provider: 'ollama', providers: {}, prompt: '   ', actionPrompts: { concise: '' } },
    )
    expect(stored.prompt).toBeUndefined()
    expect(stored.actionPrompts).toEqual({})
  })
})

describe('providerFields', () => {
  it('fills every provider from stored values over the defaults', () => {
    const fields = providerFields({ providers: { anthropic: { apiKey: 'k', model: 'claude-x' } } }, defaults)
    expect(Object.keys(fields)).toEqual(PROVIDERS.map((p) => p.id))
    expect(fields.anthropic).toEqual({ host: 'https://api.anthropic.com', model: 'claude-x', apiKey: 'k' })
    expect(fields.ollama).toEqual({ host: 'http://localhost:11434', model: 'qwen2.5:3b', apiKey: '' })
  })

  it("reads Ollama's host and model from the old top-level fields", () => {
    const fields = providerFields({ host: 'http://other:1', model: 'qwen3:4b' }, defaults)
    expect(fields.ollama).toEqual({ host: 'http://other:1', model: 'qwen3:4b', apiKey: '' })
    expect(fields.openai.model).toBe('gpt-5-mini')
  })
})

describe('activeAIConfig', () => {
  it('returns the selected provider and its fields', () => {
    const stored = { provider: 'openai', providers: { openai: { host: 'h', model: 'm', apiKey: 'k' } } }
    expect(activeAIConfig(stored)).toEqual({ provider: 'openai', host: 'h', model: 'm', apiKey: 'k' })
  })

  it('defaults to Ollama, including old-style settings, with blanks for the Go defaults', () => {
    expect(activeAIConfig({})).toEqual({ provider: 'ollama', host: '', model: '', apiKey: '' })
    expect(activeAIConfig({ model: 'qwen3:4b' })).toEqual({ provider: 'ollama', host: '', model: 'qwen3:4b', apiKey: '' })
  })
})

describe('resolveActionPrompt', () => {
  it('uses the Enter prompt for the improve action, or its default', () => {
    expect(resolveActionPrompt(IMPROVE_ID, { prompt: 'mine' })).toBe('mine')
    expect(resolveActionPrompt(IMPROVE_ID, {})).toBe(DEFAULT_PROMPTS.prompt)
  })

  it("uses the user's override, or else the default", () => {
    expect(resolveActionPrompt('concise', { actionPrompts: { concise: 'mine' } })).toBe('mine')
    expect(resolveActionPrompt('grammar', {})).toBe(DEFAULT_PROMPTS.actionPrompts.grammar)
  })
})

describe('clampSuggestionHeight', () => {
  it('keeps the height between 80px and 60% of the window', () => {
    expect(clampSuggestionHeight(10, 1000)).toBe(80)
    expect(clampSuggestionHeight(300, 1000)).toBe(300)
    expect(clampSuggestionHeight(900, 1000)).toBe(600)
  })
})
