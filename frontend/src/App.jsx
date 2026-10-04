import { useEffect, useRef, useState } from 'react'
import { Editor } from '@tinymce/tinymce-react'
import { ImproveText, GetDefaultOllamaSettings } from '../wailsjs/go/main/App'

const SETTINGS_STORAGE_KEY = 'ollamaSettings'

function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function ImproveTab({ editorRef }) {
  const [improved, setImproved] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleImprove = async () => {
    if (!editorRef.current) return
    const text = editorRef.current.getContent({ format: 'text' })
    const settings = loadStoredSettings() || {}

    setLoading(true)
    setError('')
    try {
      const result = await ImproveText(text, settings.host || '', settings.model || '', settings.prompt || '')
      setImproved(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="tab-panel">
      <button className="improve-button" onClick={handleImprove} disabled={loading}>
        {loading ? 'Improving…' : 'Improve with Ollama'}
      </button>
      {error && <p className="improve-error">{error}</p>}
      {improved && <p className="improve-result">{improved}</p>}
    </div>
  )
}

function SettingsTab() {
  const [host, setHost] = useState('')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    GetDefaultOllamaSettings().then((defaults) => {
      const stored = loadStoredSettings() || {}
      setHost(stored.host || defaults.host)
      setModel(stored.model || defaults.model)
      setPrompt(stored.prompt || defaults.prompt)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ host, model, prompt }))
  }, [host, model, prompt, loaded])

  return (
    <div className="tab-panel">
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
      <label className="settings-label">
        Prompt
        <textarea
          className="settings-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Improve the writing quality of the following text..."
          rows={8}
        />
      </label>
    </div>
  )
}

export default function App() {
  const editorRef = useRef(null)
  const [activeTab, setActiveTab] = useState('improve')

  return (
    <div className="layout">
      <div className="editor-column">
        <Editor
          tinymceScriptSrc="/tinymce/tinymce.min.js"
          licenseKey="gpl"
          onInit={(_evt, editor) => { editorRef.current = editor }}
          initialValue="<p>Start writing...</p>"
          init={{
            height: '100%',
            resize: false,
            menubar: false,
            plugins: ['advlist', 'autolink', 'lists', 'link', 'image', 'code'],
            toolbar: 'undo redo | blocks | bold italic | alignleft aligncenter alignright | bullist numlist | code',
          }}
        />
      </div>
      <div className="side-column">
        <div className="tab-bar">
          <button
            className={`tab-button ${activeTab === 'improve' ? 'active' : ''}`}
            onClick={() => setActiveTab('improve')}
          >
            Improve
          </button>
          <button
            className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>
        {activeTab === 'improve' ? <ImproveTab editorRef={editorRef} /> : <SettingsTab />}
      </div>
    </div>
  )
}
