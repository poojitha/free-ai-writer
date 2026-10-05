// Helpers for finding the text an AI action works on and for putting the
// result back. They take a TinyMCE editor but only use its DOM, selection
// and dom.getParent/isBlock, so tests can pass a small fake.

export const normalize = (text) => text.replace(/\s+/g, ' ').trim()

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Plain text from Ollama → HTML. Blank lines become paragraphs, single
// newlines become <br>.
export function textToHtml(text) {
  const paragraphs = text.split(/\n{2,}/).map((p) => escapeHtml(p).replace(/\n/g, '<br>'))
  return paragraphs.length === 1 ? paragraphs[0] : paragraphs.map((p) => `<p>${p}</p>`).join('')
}

export function fileName(path) {
  return path ? path.split(/[\\/]/).pop() : 'Untitled'
}

// Returns the text of the line the caret is on, up to the caret, plus a live
// Range over it. A "line" is the current block (paragraph, heading, list
// item), further split on <br> so Shift+Enter line breaks count too.
export function getLineBeforeCaret(editor) {
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

const TEXT_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote'

// Innermost text blocks only, in document order (a <li> holding a <p>
// counts once, as the <p>).
function getTextBlocks(body) {
  return [...body.querySelectorAll(TEXT_BLOCKS)].filter((b) => !b.querySelector(TEXT_BLOCKS))
}

// The selection if there is one. Otherwise the block the caret is in, or —
// when that's empty (e.g. right after pressing Enter) or the caret isn't in
// the editor — the nearest block with text before it.
export function getActionTarget(editor) {
  const body = editor.getBody()
  const rng = editor.selection.getRng()
  const caretInEditor = body.contains(rng.startContainer)

  if (caretInEditor && !rng.collapsed) {
    const text = editor.selection.getContent({ format: 'text' }).trim()
    if (text) return { text, range: rng.cloneRange() }
  }

  const blocks = getTextBlocks(body)

  let index = blocks.length - 1
  if (caretInEditor) {
    const current = blocks.findIndex((b) => b.contains(rng.startContainer))
    if (current !== -1) index = current
  }

  for (; index >= 0; index--) {
    const range = editor.getDoc().createRange()
    range.selectNodeContents(blocks[index])
    const text = range.toString().trim()
    if (text) return { text, range }
  }
  return null
}

// Where to put a suggestion. Normally its saved live Range, checked against
// a snapshot of the text it covered (suggestion.rangeText, taken from
// Range.toString() — which joins paragraphs with no separator, unlike the
// text sent to Ollama). If TinyMCE rebuilt those nodes the Range collapses,
// so fall back to the one block whose text still matches exactly. Returns
// null if the text was edited (replacing would clobber new writing).
export function findReplaceRange(editor, suggestion) {
  const { range, rangeText, original } = suggestion
  if (normalize(range.toString()) === normalize(rangeText)) return range

  const matches = getTextBlocks(editor.getBody()).filter(
    (b) => normalize(b.textContent) === normalize(original),
  )
  if (matches.length !== 1) return null
  const fallback = editor.getDoc().createRange()
  fallback.selectNodeContents(matches[0])
  return fallback
}

// Multi-paragraph HTML inserted inside a <p> splits it and leaves empty
// paragraphs around it, so when the range covers a whole block, widen it to
// the block element itself. Mutates and returns the range.
export function widenToBlock(editor, range, html) {
  const block = editor.dom.getParent(range.commonAncestorContainer, editor.dom.isBlock, editor.getBody())
  if (html.startsWith('<p>') && block && block !== editor.getBody() &&
      normalize(block.textContent) === normalize(range.toString())) {
    range.selectNode(block)
  }
  return range
}
