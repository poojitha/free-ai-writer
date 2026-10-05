import { useEffect, useState } from 'react'
import { GetDefaultOllamaSettings } from '../wailsjs/go/main/App'
import { CloseIcon, EnterIcon } from './icons.jsx'
import {
  ACTIONS,
  IMPROVE_ID,
  SETTINGS_STORAGE_KEY,
  loadStoredSettings,
  toStoredSettings,
} from './settings.js'

function PromptField({ id, label, hint, Icon, tint, value, defaultValue, onChange }) {
  return (
    <div className="prompt-field">
      <div className="prompt-field-head">
        <span className={`prompt-field-icon tint-${tint}`}><Icon size={14} /></span>
        <label htmlFor={`prompt-${id}`}>{label}</label>
        {hint && <span className="settings-hint">{hint}</span>}
        {defaultValue !== undefined && value !== defaultValue && (
          <button className="link-button" onClick={() => onChange(defaultValue)}>Reset</button>
        )}
      </div>
      <textarea
        id={`prompt-${id}`}
        className="settings-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    </div>
  )
}

export default function SettingsDialog({ themePreference, onThemeChange, onClose }) {
  const [host, setHost] = useState('')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [actionPrompts, setActionPrompts] = useState({})
  const [defaults, setDefaults] = useState(null)
  const [tab, setTab] = useState('general')

  useEffect(() => {
    GetDefaultOllamaSettings().then((defaults) => {
      const stored = loadStoredSettings() || {}
      setHost(stored.host || defaults.host)
      setModel(stored.model || defaults.model)
      setPrompt(stored.prompt || defaults.prompt)
      setActionPrompts({ ...defaults.actionPrompts, ...stored.actionPrompts })
      setDefaults(defaults)
    })
  }, [])

  useEffect(() => {
    if (!defaults) return
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(toStoredSettings({ host, model, prompt, actionPrompts }, defaults)),
    )
  }, [host, model, prompt, actionPrompts, defaults])

  const setActionPrompt = (id, value) => setActionPrompts((prev) => ({ ...prev, [id]: value }))

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-head">
          <h2 id="settings-title">Settings</h2>
          <button className="suggestion-dismiss" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="dialog-tabs" role="tablist">
          {[['general', 'General'], ['prompts', 'Prompts']].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <>
            <div className="settings-section">
              <span className="settings-label">Appearance</span>
              <div className="segmented" role="radiogroup" aria-label="Theme">
                {['system', 'light', 'dark'].map((t) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={themePreference === t}
                    className={themePreference === t ? 'active' : ''}
                    onClick={() => onThemeChange(t)}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <label className="settings-label">
                Ollama host
                <input
                  className="settings-input"
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </label>
              <label className="settings-label">
                Model
                <input
                  className="settings-input"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="llama3.1:8b"
                />
              </label>
            </div>
          </>
        )}

        {tab === 'prompts' && (
          <div className="settings-section">
            {ACTIONS.map(({ id, label, Icon, tint }) => id === IMPROVE_ID ? (
              <PromptField
                key={id}
                id={id}
                label={label}
                hint={<>also runs when you press <kbd><EnterIcon size={12} /> Enter</kbd></>}
                Icon={Icon}
                tint={tint}
                value={prompt}
                defaultValue={defaults?.prompt}
                onChange={setPrompt}
              />
            ) : (
              <PromptField
                key={id}
                id={id}
                label={label}
                Icon={Icon}
                tint={tint}
                value={actionPrompts[id] || ''}
                defaultValue={defaults?.actionPrompts[id]}
                onChange={(value) => setActionPrompt(id, value)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
