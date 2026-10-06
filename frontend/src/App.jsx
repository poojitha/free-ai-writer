import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from '@tinymce/tinymce-react'
import {
  ChooseSavePath,
  ImproveText,
  GetDefaultSettings,
  OpenDocument,
  WriteDocument,
} from '../wailsjs/go/main/App'
import { ClipboardSetText, WindowSetTitle } from '../wailsjs/runtime/runtime'
import { useTheme } from './theme.js'
import logo from './assets/hush-logo.png'
import SettingsDialog from './SettingsDialog.jsx'
import { exportDocument, formatFromPath, importDocument } from './documentFormats.js'
import {
  fileName,
  findReplaceRange,
  getActionTarget,
  getLineBeforeCaret,
  textToHtml,
  widenToBlock,
} from './editorText.js'
import {
  ACTIONS,
  DEFAULT_SUGGESTION_HEIGHT,
  SUGGESTION_HEIGHT_STORAGE_KEY,
  activeAIConfig,
  clampSuggestionHeight,
  loadStoredSettings,
  resolveActionPrompt,
} from './settings.js'
import {
  CloseIcon,
  FolderIcon,
  InfoIcon,
  MoonIcon,
  PenIcon,
  SaveIcon,
  SettingsIcon,
  SparkleIcon,
  SunIcon,
} from './icons.jsx'

function IconButton({ label, onClick, active, children }) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
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
        <div className="suggestion-actions">
          {stale && <span className="suggestion-stale">Original text has changed</span>}
          {improved && <button className="text-button" onClick={onCopy}>Copy</button>}
          {improved && !stale && <button className="text-button primary" onClick={onApply}>Replace</button>}
          <button className="suggestion-dismiss" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
            <CloseIcon />
          </button>
        </div>
      </div>
      <p className="suggestion-original">{original}</p>
      {loading && <div className="suggestion-loading"><span /><span /><span /></div>}
      {error && <p className="suggestion-error">{error}</p>}
      {improved && <p className="suggestion-result">{improved}</p>}
    </div>
  )
}

// Drag handle along the top edge of the AI bar. Dragging sets the suggestion
// list's max height: up grows it, down shrinks it. The drag starts from the
// list's rendered height, which is less than the max when the content is
// short, so the list responds immediately.
function ResizeHandle({ listRef, maxHeight, onResize }) {
  const startResize = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = listRef.current?.offsetHeight ?? maxHeight
    const onMove = (ev) => onResize(startHeight + (startY - ev.clientY))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.classList.add('resizing')
  }

  return (
    <div
      className="assist-resize"
      onPointerDown={startResize}
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize"
    />
  )
}

export default function App() {
  const editorRef = useRef(null)
  const nextIdRef = useRef(0)
  const [themePreference, setThemePreference, theme] = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [docPath, setDocPath] = useState('')
  const [dirty, setDirty] = useState(false)
  // The formatting toolbar starts hidden each launch; the pen button shows it.
  const [toolbarOpen, setToolbarOpen] = useState(false)
  // Newest first. Each entry: { id, label, original, range, improved, error, loading, stale }.
  const [suggestions, setSuggestions] = useState([])
  const suggestionListRef = useRef(null)
  const [suggestionHeight, setSuggestionHeight] = useState(
    () => Number(localStorage.getItem(SUGGESTION_HEIGHT_STORAGE_KEY)) || DEFAULT_SUGGESTION_HEIGHT,
  )

  const resizeSuggestion = (height) => setSuggestionHeight(clampSuggestionHeight(height, window.innerHeight))

  useEffect(() => {
    localStorage.setItem(SUGGESTION_HEIGHT_STORAGE_KEY, String(suggestionHeight))
  }, [suggestionHeight])

  const isDark = theme === 'dark'

  useEffect(() => {
    // TinyMCE measured the toolbar while it was hidden; have it re-measure
    // which buttons fit before the overflow (⋯) menu.
    if (toolbarOpen) window.dispatchEvent(new Event('resize'))
  }, [toolbarOpen])

  useEffect(() => {
    WindowSetTitle(`${dirty ? '• ' : ''}${fileName(docPath)} — Hush Writer`)
  }, [docPath, dirty])

  const updateSuggestion = (id, fields) =>
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)))

  const runSuggestion = async (target, label, prompt) => {
    if (!target) return
    const id = nextIdRef.current++
    setSuggestions((prev) => [
      {
        id,
        label,
        original: target.text,
        range: target.range,
        // Range.toString() joins paragraphs with no separator, unlike
        // target.text, so the stale check compares against this instead.
        rangeText: target.range.toString(),
        improved: '',
        error: '',
        loading: true,
      },
      ...prev,
    ])
    // Newest is at the top; bring it into view.
    suggestionListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

    const settings = loadStoredSettings() || {}
    try {
      const improved = await ImproveText(target.text, prompt, activeAIConfig(settings))
      updateSuggestion(id, { improved, loading: false })
    } catch (err) {
      updateSuggestion(id, { error: String(err), loading: false })
    }
  }

  // The editor's keydown handler is registered once in setup, so route it
  // through a ref to always call the latest version.
  const improveLineRef = useRef(null)
  improveLineRef.current = (target) =>
    runSuggestion(target, 'Improve writing', (loadStoredSettings() || {}).prompt || '')

  const runAction = async (action) => {
    const editor = editorRef.current
    if (!editor) return
    // Capture the target before awaiting, while the selection is current.
    const target = getActionTarget(editor)
    if (!target) return
    const prompt = await resolveActionPrompt(action.id, loadStoredSettings() || {}, GetDefaultSettings)
    runSuggestion(target, action.label, prompt)
  }

  const applySuggestion = (s) => {
    const editor = editorRef.current
    if (!editor) return
    const range = findReplaceRange(editor, s)
    if (!range) {
      updateSuggestion(s.id, { stale: true })
      return
    }
    const html = textToHtml(s.improved)
    widenToBlock(editor, range, html)
    editor.focus()
    editor.undoManager.transact(() => {
      editor.selection.setRng(range)
      editor.selection.setContent(html)
    })
    dismissSuggestion(s.id)
  }

  const dismissSuggestion = (id) => setSuggestions((prev) => prev.filter((s) => s.id !== id))

  // Saves to the current file, or asks where (and as which format: .docx by
  // default, .txt or .html) for a new file or Save As.
  const save = useCallback(async (saveAs = false) => {
    const editor = editorRef.current
    if (!editor) return
    try {
      const path = saveAs || !docPath ? await ChooseSavePath(docPath) : docPath
      if (!path) return
      const data = await exportDocument(
        formatFromPath(path),
        editor.getContent(),
        editor.getContent({ format: 'text' }),
      )
      await WriteDocument(path, data)
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
      editor.setContent(await importDocument(doc.path, doc.data))
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
      if (key === 's') { e.preventDefault(); save(e.shiftKey) }
      if (key === 'o') { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save, open])

  return (
    <div className="app">
      <header className="topbar">
        <div className="doc-name">
          <img className="app-logo" src={logo} alt="Hush Writer" />
          {fileName(docPath)}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </div>
        {/* TinyMCE renders its toolbar here (fixed_toolbar_container). */}
        <div id="editor-toolbar" className={`editor-toolbar ${toolbarOpen ? '' : 'hidden'}`} />
        <div className="topbar-actions">
          <IconButton
            label={toolbarOpen ? 'Hide formatting toolbar' : 'Show formatting toolbar'}
            active={toolbarOpen}
            onClick={() => setToolbarOpen((open) => !open)}
          >
            <PenIcon />
          </IconButton>
          <IconButton
            label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setThemePreference(isDark ? 'light' : 'dark')}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          <IconButton
            label="Save (Ctrl+S). Shift+click or Ctrl+Shift+S to save as Word, text or HTML"
            onClick={(e) => save(e.shiftKey)}
          >
            <SaveIcon />
          </IconButton>
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
              toolbar:
                'undo redo | blocks | bold italic underline strikethrough | ' +
                'alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | ' +
                'blockquote image | removeformat',
              toolbar_mode: 'floating',
              fixed_toolbar_container: '#editor-toolbar',
              toolbar_persist: true,
              placeholder: 'Start writing…',
              plugins: ['autolink', 'lists', 'image'],
              // There's no server to upload to, so images (inserted from the
              // dialog's Upload tab, pasted or dropped) are embedded in the
              // document as data: URLs and saved with it.
              images_upload_handler: (blobInfo) =>
                Promise.resolve(`data:${blobInfo.blob().type};base64,${blobInfo.base64()}`),
              // The types a Word file can embed.
              images_file_types: 'jpeg,jpg,jpe,jfi,jif,jfif,png,gif,bmp',
              image_description: true,
              image_dimensions: true,
              setup: (editor) => {
                // The image dialog opens on its General (URL) tab. For a new
                // image start on Upload, since local files are the usual
                // source; editing an image keeps General, with its size and
                // alt text. It's recognised by its upload drop zone.
                editor.on('OpenWindow', ({ dialog }) => {
                  const data = dialog.getData()
                  if ('fileinput' in data && !data.src?.value) dialog.showTab('upload')
                })
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
        <ResizeHandle listRef={suggestionListRef} maxHeight={suggestionHeight} onResize={resizeSuggestion} />
        <div className="assist-head">
          <span className="assist-sparkle"><SparkleIcon size={18} /></span>
          <span>AI-Powered Suggestions</span>
          <span
            className="assist-info"
            title="Pick an action to rewrite the selected text. With nothing selected, it uses the paragraph the cursor is in, or the last line you wrote. Pressing Enter improves the line you just wrote."
          >
            <InfoIcon />
          </span>
          {suggestions.length > 0 && (
            <button className="text-button assist-clear" onClick={() => setSuggestions([])}>Clear all</button>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="suggestion-list" ref={suggestionListRef} style={{ maxHeight: suggestionHeight }}>
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
              <span className={`chip-icon tint-${action.tint}`}><action.Icon size={17} /></span>
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
