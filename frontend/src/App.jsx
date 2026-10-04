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

// Returns the text of the line the caret is on, up to the caret. A "line" is
// the current block (paragraph, heading, list item), further split on <br>
// so Shift+Enter line breaks count too.
function getLineBeforeCaret(editor) {
  const rng = editor.selection.getRng()
  const block = editor.dom.getParent(rng.startContainer, editor.dom.isBlock, editor.getBody())
  if (!block) return ''

  const before = editor.getDoc().createRange()
  before.setStart(block, 0)
  before.setEnd(rng.startContainer, rng.startOffset)

  const container = editor.getDoc().createElement('div')
  container.appendChild(before.cloneContents())
  container.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))

  const lines = container.textContent.split('\n')
  return lines[lines.length - 1].trim()
}

function ImproveTab({ results, onImproveAll }) {
  const busy = results.some((r) => r.loading)

  return (
    <div className="tab-panel">
      <button className="improve-button" onClick={onImproveAll} disabled={busy}>
        {busy ? 'Improving…' : 'Improve all with Ollama'}
      </button>
      <p className="improve-hint">Press Enter in the editor to improve the line you just wrote.</p>
      {results.map((r) => (
        <div key={r.id} className="improve-entry">
          <p className="improve-original">{r.original}</p>
          {r.loading && <p className="improve-pending">Improving…</p>}
          {r.error && <p className="improve-error">{r.error}</p>}
          {r.improved && <p className="improve-result">{r.improved}</p>}
        </div>
      ))}
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
  const nextIdRef = useRef(0)
  const [activeTab, setActiveTab] = useState('improve')
  // Newest first. Each entry: { id, original, improved, error, loading }.
  const [results, setResults] = useState([])

  const improve = async (text) => {
    if (!text.trim()) return
    const id = nextIdRef.current++
    const update = (fields) =>
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)))

    setResults((prev) => [{ id, original: text, improved: '', error: '', loading: true }, ...prev])

    const settings = loadStoredSettings() || {}
    try {
      const improved = await ImproveText(text, settings.host || '', settings.model || '', settings.prompt || '')
      update({ improved, loading: false })
    } catch (err) {
      update({ error: String(err), loading: false })
    }
  }

  // The editor's keydown handler is registered once in setup, so route it
  // through a ref to always call the latest improve.
  const improveRef = useRef(improve)
  improveRef.current = improve

  const handleImproveAll = () => {
    if (!editorRef.current) return
    improve(editorRef.current.getContent({ format: 'text' }))
  }

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
            setup: (editor) => {
              editor.on('keydown', (e) => {
                if (e.key !== 'Enter' || e.isComposing) return
                // Read the line before TinyMCE splits the block.
                const line = getLineBeforeCaret(editor)
                if (line) improveRef.current(line)
              })
            },
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
        {activeTab === 'improve'
          ? <ImproveTab results={results} onImproveAll={handleImproveAll} />
          : <SettingsTab />}
      </div>
    </div>
  )
}
