// Persisted user settings: the AI provider and its connection, prompts, the
// AI actions they apply to, and the suggestion list height.
import { BulbIcon, DocIcon, ShieldIcon, SmileIcon, WandIcon } from './icons.jsx'

// Kept under its original name so existing users' settings survive.
export const SETTINGS_STORAGE_KEY = 'ollamaSettings'

// AI providers, matching the keys of `providers` in Go (ai.go), which also
// holds each one's default host and model. Settings for every provider are
// kept, so switching back and forth keeps each one's key and model. apiKey
// says whether the API key field is shown and if it must be filled in.
// "Other" is any OpenAI-compatible server and has no defaults.
export const DEFAULT_PROVIDER = 'ollama'
export const PROVIDERS = [
  { id: 'ollama', label: 'Ollama (local)', hostLabel: 'Ollama host' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', hostLabel: 'OpenAI API URL', apiKey: 'required' },
  { id: 'anthropic', label: 'Claude (Anthropic)', hostLabel: 'Anthropic API URL', apiKey: 'required' },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    hostLabel: 'API URL',
    hostPlaceholder: 'e.g. http://localhost:1234/v1 or https://openrouter.ai/api/v1',
    hint: 'Any OpenAI-compatible API, such as LM Studio, OpenRouter, Groq or Mistral.',
    apiKey: 'optional',
  },
]

const RETURN_ONLY = ' Return only the rewritten text, with no preamble or explanation.'

// Suggestion bar actions. Each runs on the selection, or on the paragraph the
// caret is in when nothing is selected, using its default `prompt`; user edits
// are stored as overrides under ollamaSettings.actionPrompts. The exception is
// IMPROVE_ID, which shares the Enter-key prompt (ollamaSettings.prompt).
export const IMPROVE_ID = 'improve'
export const ACTIONS = [
  {
    id: IMPROVE_ID,
    label: 'Improve writing',
    Icon: DocIcon,
    tint: 'blue',
    prompt:
      'Improve the following text so it is clear and reads smoothly. ' +
      'Fix grammar, simplify confusing or awkward phrasing, and improve flow, ' +
      'while keeping the original meaning and voice. Return only the improved ' +
      'text, with no preamble or explanation.',
  },
  {
    id: 'concise',
    label: 'Make it more concise',
    Icon: WandIcon,
    tint: 'green',
    prompt: 'Rewrite the following text to be more concise. Remove filler and redundancy but keep every idea.' + RETURN_ONLY,
  },
  {
    id: 'tone',
    label: 'Improve tone',
    Icon: SmileIcon,
    tint: 'amber',
    prompt: 'Rewrite the following text with a warmer, more natural and engaging tone, keeping its meaning.' + RETURN_ONLY,
  },
  {
    id: 'expand',
    label: 'Expand this idea',
    Icon: BulbIcon,
    tint: 'violet',
    prompt: 'Expand the following text with more detail, examples, or depth, in the same voice and style.' + RETURN_ONLY,
  },
  {
    id: 'grammar',
    label: 'Fix grammar',
    Icon: ShieldIcon,
    tint: 'red',
    prompt: 'Fix the grammar, spelling, and punctuation of the following text. Change nothing else.' + RETURN_ONLY,
  },
]

// The default prompts, in the shape they're stored in: `prompt` is the
// Enter-key (and improve action) prompt, `actionPrompts` the others by id.
export const DEFAULT_PROMPTS = {
  prompt: ACTIONS.find((a) => a.id === IMPROVE_ID).prompt,
  actionPrompts: Object.fromEntries(ACTIONS.filter((a) => a.id !== IMPROVE_ID).map((a) => [a.id, a.prompt])),
}

export function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// One provider's stored { host, model, apiKey }. Before there was a choice of
// provider, Ollama's host and model were stored at the top level.
function storedProvider(stored, id) {
  const legacy = id === DEFAULT_PROVIDER ? { host: stored.host, model: stored.model } : {}
  return { ...legacy, ...stored.providers?.[id] }
}

// The Settings dialog's per-provider fields: stored values over the Go
// defaults.
export function providerFields(stored, defaults) {
  return Object.fromEntries(
    PROVIDERS.map(({ id }) => {
      const s = storedProvider(stored, id)
      const d = defaults.providers?.[id] || {}
      return [id, { host: s.host || d.host || '', model: s.model || d.model || '', apiKey: s.apiKey || '' }]
    }),
  )
}

// The AIConfig to pass to ImproveText. Empty fields make Go use the
// provider's defaults.
export function activeAIConfig(stored) {
  const provider = stored.provider || DEFAULT_PROVIDER
  const { host = '', model = '', apiKey = '' } = storedProvider(stored, provider)
  return { provider, host, model, apiKey }
}

// What to persist for the Settings dialog's values. Prompts are only kept
// when the user changed them, so improved defaults still reach everyone else.
export function toStoredSettings({ provider, providers, prompt, actionPrompts }) {
  const isOverride = (p, def) => p.trim() && p !== def
  return {
    provider,
    providers,
    prompt: isOverride(prompt, DEFAULT_PROMPTS.prompt) ? prompt : undefined,
    actionPrompts: Object.fromEntries(
      Object.entries(actionPrompts).filter(([id, p]) => isOverride(p, DEFAULT_PROMPTS.actionPrompts[id])),
    ),
  }
}

// The prompt to send for an action: the user's override, else the default.
// The improve action uses the Enter-key prompt.
export function resolveActionPrompt(actionId, stored) {
  if (actionId === IMPROVE_ID) return stored.prompt || DEFAULT_PROMPTS.prompt
  return stored.actionPrompts?.[actionId] || DEFAULT_PROMPTS.actionPrompts[actionId]
}

export const SUGGESTION_HEIGHT_STORAGE_KEY = 'suggestionHeight'
export const DEFAULT_SUGGESTION_HEIGHT = 220
const MIN_SUGGESTION_HEIGHT = 80

// The suggestion list's max height, kept between a minimum and 60% of the
// window.
export function clampSuggestionHeight(height, windowHeight) {
  const max = Math.round(windowHeight * 0.6)
  return Math.round(Math.min(max, Math.max(MIN_SUGGESTION_HEIGHT, height)))
}
