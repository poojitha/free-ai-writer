// Persisted user settings: Ollama connection and prompts, the AI actions they
// apply to, and the suggestion list height.
import { BulbIcon, DocIcon, ShieldIcon, SmileIcon, WandIcon } from './icons.jsx'

export const SETTINGS_STORAGE_KEY = 'ollamaSettings'

// Suggestion bar actions. Each runs on the selection, or on the paragraph the
// caret is in when nothing is selected. Default prompts come from Go
// (GetDefaultOllamaSettings().actionPrompts, keyed by id); user edits are
// stored as overrides under ollamaSettings.actionPrompts. The exception is
// IMPROVE_ID, which shares the Enter-key prompt (ollamaSettings.prompt).
export const IMPROVE_ID = 'improve'
export const ACTIONS = [
  {
    id: IMPROVE_ID,
    label: 'Improve writing',
    Icon: DocIcon,
    tint: 'blue',
  },
  {
    id: 'concise',
    label: 'Make it more concise',
    Icon: WandIcon,
    tint: 'green',
  },
  {
    id: 'tone',
    label: 'Improve tone',
    Icon: SmileIcon,
    tint: 'amber',
  },
  {
    id: 'expand',
    label: 'Expand this idea',
    Icon: BulbIcon,
    tint: 'violet',
  },
  {
    id: 'grammar',
    label: 'Fix grammar',
    Icon: ShieldIcon,
    tint: 'red',
  },
]

export function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// What to persist for the Settings dialog's values. Prompts are only kept
// when the user changed them, so improved defaults still reach everyone else.
export function toStoredSettings({ host, model, prompt, actionPrompts }, defaults) {
  const isOverride = (p, def) => p.trim() && p !== def
  return {
    host,
    model,
    prompt: isOverride(prompt, defaults.prompt) ? prompt : undefined,
    actionPrompts: Object.fromEntries(
      Object.entries(actionPrompts).filter(([id, p]) => isOverride(p, defaults.actionPrompts[id])),
    ),
  }
}

// The prompt to send for an action. The improve action uses the Enter-key
// prompt, where '' makes ImproveText fall back to the Go default; the others
// use the user's override or else the Go default (fetched only if needed).
export async function resolveActionPrompt(actionId, stored, getDefaults) {
  if (actionId === IMPROVE_ID) return stored.prompt || ''
  return stored.actionPrompts?.[actionId] || (await getDefaults()).actionPrompts[actionId]
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
