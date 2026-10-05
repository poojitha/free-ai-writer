import { useEffect, useState } from 'react'
import { GetDefaultSettings } from '../wailsjs/go/main/App'
import { CloseIcon, EnterIcon } from './icons.jsx'
import {
  ACTIONS,
  DEFAULT_PROVIDER,
  IMPROVE_ID,
  PROVIDERS,
  SETTINGS_STORAGE_KEY,
  loadStoredSettings,
  providerFields,
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
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const [providers, setProviders] = useState({})
  const [prompt, setPrompt] = useState('')
  const [actionPrompts, setActionPrompts] = useState({})
  const [defaults, setDefaults] = useState(null)
  const [tab, setTab] = useState('general')
  // The JSON last written to localStorage, to tell if there are unsaved edits.
  const [savedJson, setSavedJson] = useState(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    GetDefaultSettings().then((defaults) => {
      const stored = loadStoredSettings() || {}
      const initial = {
        provider: stored.provider || DEFAULT_PROVIDER,
        providers: providerFields(stored, defaults),
        prompt: stored.prompt || defaults.prompt,
        actionPrompts: { ...defaults.actionPrompts, ...stored.actionPrompts },
      }
      setProvider(initial.provider)
      setProviders(initial.providers)
      setPrompt(initial.prompt)
      setActionPrompts(initial.actionPrompts)
      setDefaults(defaults)
      setSavedJson(JSON.stringify(toStoredSettings(initial, defaults)))
    })
  }, [])

  // AI and prompt edits are kept here until Save; the theme applies at once.
  const draftJson = defaults && JSON.stringify(toStoredSettings({ provider, providers, prompt, actionPrompts }, defaults))
  const dirty = draftJson !== savedJson

  useEffect(() => {
    if (dirty) setJustSaved(false)
  }, [dirty])

  const save = () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, draftJson)
    setSavedJson(draftJson)
    setJustSaved(true)
  }

  const setActionPrompt = (id, value) => setActionPrompts((prev) => ({ ...prev, [id]: value }))

  const activeProvider = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0]
  const fields = providers[activeProvider.id]
  const providerDefaults = defaults?.providers?.[activeProvider.id] || {}
  const setField = (name, value) =>
    setProviders((prev) => ({ ...prev, [activeProvider.id]: { ...prev[activeProvider.id], [name]: value } }))

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
                AI provider
                <select
                  className="settings-input settings-select"
                  value={activeProvider.id}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              {activeProvider.hint && <p className="settings-hint provider-hint">{activeProvider.hint}</p>}
              {fields && (
                <>
                  <label className="settings-label">
                    {activeProvider.hostLabel}
                    <input
                      className="settings-input"
                      type="text"
                      value={fields.host}
                      onChange={(e) => setField('host', e.target.value)}
                      placeholder={providerDefaults.host || activeProvider.hostPlaceholder}
                    />
                  </label>
                  <label className="settings-label">
                    Model
                    <input
                      className="settings-input"
                      type="text"
                      value={fields.model}
                      onChange={(e) => setField('model', e.target.value)}
                      placeholder={providerDefaults.model || 'Model name, as the API expects it'}
                    />
                  </label>
                  {activeProvider.apiKey && (
                    <label className="settings-label">
                      API key
                      {activeProvider.apiKey === 'optional' && <span className="settings-hint"> (if the server needs one)</span>}
                      <input
                        className="settings-input"
                        type="password"
                        autoComplete="off"
                        value={fields.apiKey}
                        onChange={(e) => setField('apiKey', e.target.value)}
                      />
                      <span className="settings-hint">Stored on this computer only.</span>
                    </label>
                  )}
                </>
              )}
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

        <div className="dialog-foot">
          <span className="settings-hint" role="status">
            {dirty ? 'Unsaved changes' : justSaved ? 'Saved' : ''}
          </span>
          <button className="text-button primary" onClick={save} disabled={!defaults || !dirty}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
