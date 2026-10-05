import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from '@tinymce/tinymce-react'
import {
  ImproveText,
  GetDefaultOllamaSettings,
  OpenDocument,
  SaveDocument,
} from '../wailsjs/go/main/App'
import { ClipboardSetText, WindowSetTitle } from '../wailsjs/runtime/runtime'
import { useTheme } from './theme.js'
import {
  BulbIcon,
  CloseIcon,
  DocIcon,
  FolderIcon,
  InfoIcon,
  MoonIcon,
  SaveIcon,
  SettingsIcon,
  ShieldIcon,
  SmileIcon,
  SparkleIcon,
  SunIcon,
  WandIcon,
} from './icons.jsx'

const SETTINGS_STORAGE_KEY = 'ollamaSettings'
const RETURN_ONLY = ' Return only the rewritten text, with no preamble or explanation.'

// Suggestion bar actions. Each runs on the selection, or on the paragraph the
// caret is in when nothing is selected.
const ACTIONS = [
  {
    id: 'clarify',
    label: 'Clarify this sentence',
    Icon: DocIcon,
    tint: 'blue',
    prompt: 'Rewrite the following text so it is clearer and easier to understand, keeping its meaning.' + RETURN_ONLY,
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

function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim()

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Plain text from Ollama → HTML. Blank lines become paragraphs, single
// newlines become <br>.
function textToHtml(text) {
  const paragraphs = text.split(/\n{2,}/).map((p) => escapeHtml(p).replace(/\n/g, '<br>'))
  return paragraphs.length === 1 ? paragraphs[0] : paragraphs.map((p) => `<p>${p}</p>`).join('')
}

// Returns the text of the line the caret is on, up to the caret, plus a live
// Range over it. A "line" is the current block (paragraph, heading, list
// item), further split on <br> so Shift+Enter line breaks count too.
function getLineBeforeCaret(editor) {
  const rng = editor.selection.getRng()
  const block = editor.dom.getParent(rng.startContainer, editor.dom.isBlock, editor.getBody())
  if (!block) return null

  const doc = editor.getDoc()
  const before = doc.createRange()
  before.setStart(block, 0)
  before.setEnd(rng.startContainer, rng.startOffset)

  let lastBr = null
  block.querySelectorAll('br').forEach((br) => {
    const afterBr = doc.createRange()
    afterBr.setStartAfter(br)
    if (before.isPointInRange(afterBr.startContainer, afterBr.startOffset)) lastBr = br
  })
  if (lastBr) before.setStartAfter(lastBr)

  const text = before.toString().trim()
  return text ? { text, range: before } : null
}

// The selection if there is one, otherwise the whole block the caret is in.
function getActionTarget(editor) {
  const rng = editor.selection.getRng()
  if (!rng.collapsed) {
    const text = editor.selection.getContent({ format: 'text' }).trim()
    if (text) return { text, range: rng.cloneRange() }
  }

  const block = editor.dom.getParent(rng.startContainer, editor.dom.isBlock, editor.getBody())
  if (!block) return null
  const range = editor.getDoc().createRange()
  range.selectNodeContents(block)
  const text = range.toString().trim()
  return text ? { text, range } : null
}

function fileName(path) {
  return path ? path.split(/[\\/]/).pop() : 'Untitled'
}

function IconButton({ label, onClick, children }) {
  return (
    <button className="icon-button" onClick={onClick} title={label} aria-label={label}>
      {children}
    </button>
  )
}

function SuggestionCard({ suggestion, onApply, onCopy, onDismiss }) {
  const { label, original, improved, error, loading, stale } = suggestion
  return (
    <div className="suggestion-card">
      <div className="suggestion-head">
        <span className="suggestion-label">{label}</span>
        <button className="suggestion-dismiss" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
          <CloseIcon />
        </button>
      </div>
      <p className="suggestion-original">{original}</p>
      {loading && <div className="suggestion-loading"><span /><span /><span /></div>}
      {error && <p className="suggestion-error">{error}</p>}
      {improved && (
        <>
          <p className="suggestion-result">{improved}</p>
          <div className="suggestion-actions">
            {stale && <span className="suggestion-stale">Original text has changed</span>}
            <button className="text-button" onClick={onCopy}>Copy</button>
            {!stale && <button className="text-button primary" onClick={onApply}>Replace</button>}
          </div>
        </>
      )}
    </div>
  )
}

function SettingsDialog({ themePreference, onThemeChange, onClose }) {
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
          <label className="settings-label">
            Improve prompt <span className="settings-hint">— used when you press Enter</span>
            <textarea
              className="settings-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Improve the writing quality of the following text..."
              rows={6}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const editorRef = useRef(null)
  const nextIdRef = useRef(0)
  const [themePreference, setThemePreference, theme] = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [docPath, setDocPath] = useState('')
  const [dirty, setDirty] = useState(false)
  // Newest first. Each entry: { id, label, original, range, improved, error, loading, stale }.
  const [suggestions, setSuggestions] = useState([])

  const isDark = theme === 'dark'

  useEffect(() => {
    WindowSetTitle(`${dirty ? '• ' : ''}${fileName(docPath)} — Write`)
  }, [docPath, dirty])

  const updateSuggestion = (id, fields) =>
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)))

  const runSuggestion = async (target, label, prompt) => {
    if (!target) return
    const id = nextIdRef.current++
    setSuggestions((prev) => [
      { id, label, original: target.text, range: target.range, improved: '', error: '', loading: true },
      ...prev,
    ])

    const settings = loadStoredSettings() || {}
    try {
      const improved = await ImproveText(target.text, settings.host || '', settings.model || '', prompt)
      updateSuggestion(id, { improved, loading: false })
    } catch (err) {
      updateSuggestion(id, { error: String(err), loading: false })
    }
  }

  // The editor's keydown handler is registered once in setup, so route it
  // through a ref to always call the latest version.
  const improveLineRef = useRef(null)
  improveLineRef.current = (target) =>
    runSuggestion(target, 'Improve', (loadStoredSettings() || {}).prompt || '')

  const runAction = (action) => {
    const editor = editorRef.current
    if (!editor) return
    runSuggestion(getActionTarget(editor), action.label, action.prompt)
  }

  // The stored Range is live, so it tracks edits around it. If the text it
  // covers no longer matches what was sent, replacing would clobber new
  // writing, so the suggestion is marked stale instead.
  const applySuggestion = (s) => {
    const editor = editorRef.current
    if (!editor) return
    if (normalize(s.range.toString()) !== normalize(s.original)) {
      updateSuggestion(s.id, { stale: true })
      return
    }
    editor.focus()
    editor.undoManager.transact(() => {
      editor.selection.setRng(s.range)
      editor.selection.setContent(textToHtml(s.improved))
    })
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id))
  }

  const dismissSuggestion = (id) => setSuggestions((prev) => prev.filter((s) => s.id !== id))

  const save = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    try {
      const path = await SaveDocument(docPath, editor.getContent())
      if (!path) return
      setDocPath(path)
      setDirty(false)
      editor.setDirty(false)
    } catch (err) {
      alert(`Could not save: ${err}`)
    }
  }, [docPath])

  const open = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    if (dirty && !confirm('Discard unsaved changes?')) return
    try {
      const doc = await OpenDocument()
      if (!doc.path) return
      editor.setContent(doc.content)
      editor.undoManager.clear()
      editor.setDirty(false)
      setDocPath(doc.path)
      setDirty(false)
      setSuggestions([])
    } catch (err) {
      alert(`Could not open: ${err}`)
    }
  }, [dirty])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 's') { e.preventDefault(); save() }
      if (key === 'o') { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save, open])

  return (
    <div className="app">
      <header className="topbar">
        <div className="doc-name">
          {fileName(docPath)}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </div>
        <div className="topbar-actions">
          <IconButton
            label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setThemePreference(isDark ? 'light' : 'dark')}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          <IconButton label="Save (Ctrl+S)" onClick={save}><SaveIcon /></IconButton>
          <IconButton label="Open (Ctrl+O)" onClick={open}><FolderIcon /></IconButton>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}><SettingsIcon /></IconButton>
        </div>
      </header>

      <main className="page" onMouseDown={(e) => {
        // Clicking the empty margin around the text should still focus it.
        if (e.target === e.currentTarget && editorRef.current) {
          e.preventDefault()
          editorRef.current.focus()
        }
      }}>
        <div className="doc">
          <Editor
            tinymceScriptSrc="/tinymce/tinymce.min.js"
            licenseKey="gpl"
            inline
            onInit={(_evt, editor) => { editorRef.current = editor }}
            onDirty={() => setDirty(true)}
            init={{
              // The skin is loaded by theme.js so it can follow the theme.
              skin: false,
              content_css: false,
              menubar: false,
              toolbar: false,
              placeholder: 'Start writing…',
              plugins: ['autolink', 'lists', 'link', 'quickbars'],
              quickbars_selection_toolbar: 'bold italic | h1 h2 blockquote | bullist numlist | quicklink',
              quickbars_insert_toolbar: false,
              setup: (editor) => {
                editor.on('keydown', (e) => {
                  if (e.key !== 'Enter' || e.isComposing) return
                  // Read the line before TinyMCE splits the block.
                  const target = getLineBeforeCaret(editor)
                  if (target) improveLineRef.current(target)
                })
              },
            }}
          />
        </div>
      </main>

      <footer className="assist">
        <div className="assist-head">
          <span className="assist-sparkle"><SparkleIcon /></span>
          <span>AI-Powered Suggestions</span>
          <span
            className="assist-info"
            title="Select text, or place the cursor in a paragraph, then pick an action. Pressing Enter improves the line you just wrote."
          >
            <InfoIcon />
          </span>
          {suggestions.length > 0 && (
            <button className="text-button assist-clear" onClick={() => setSuggestions([])}>Clear all</button>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="suggestion-list">
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onApply={() => applySuggestion(s)}
                onCopy={() => ClipboardSetText(s.improved)}
                onDismiss={() => dismissSuggestion(s.id)}
              />
            ))}
          </div>
        )}

        <div className="chips">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              className="chip"
              // Keep focus (and the selection) in the editor.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runAction(action)}
            >
              <span className={`chip-icon tint-${action.tint}`}><action.Icon /></span>
              {action.label}
            </button>
          ))}
        </div>
      </footer>

      {settingsOpen && (
        <SettingsDialog
          themePreference={themePreference}
          onThemeChange={setThemePreference}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
