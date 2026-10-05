import { describe, expect, it } from 'vitest'
import {
  fileName,
  findReplaceRange,
  getActionTarget,
  getLineBeforeCaret,
  normalize,
  textToHtml,
  widenToBlock,
} from './editorText.js'

const BLOCK = /^(P|H[1-6]|LI|UL|OL|PRE|BLOCKQUOTE|DIV)$/

// A minimal stand-in for a TinyMCE editor over a jsdom document: the editor
// body plus some UI outside it, and a selection the test controls.
function fakeEditor(html) {
  document.body.innerHTML = `<div id="body">${html}</div><footer id="ui"><p>Fix grammar</p></footer>`
  const body = document.getElementById('body')
  let rng = document.createRange()
  rng.setStart(body, 0)

  return {
    getBody: () => body,
    getDoc: () => document,
    selection: {
      getRng: () => rng,
      setRng: (r) => { rng = r },
      // Like TinyMCE's text format: blocks separated by blank lines.
      getContent: () => {
        const div = document.createElement('div')
        div.appendChild(rng.cloneContents())
        const blocks = [...div.querySelectorAll('p,li,h1,h2')]
        return blocks.length ? blocks.map((b) => b.textContent).join('\n\n') : div.textContent
      },
    },
    dom: {
      isBlock: (node) => node.nodeType === 1 && BLOCK.test(node.nodeName),
      // Like TinyMCE's DOMUtils.getParent: walks up to, but not including, root.
      getParent: (node, pred, root) => {
        for (let n = node; n && n !== root; n = n.parentNode) if (pred(n)) return n
        return null
      },
    },
  }
}

const $ = (selector) => document.querySelector(selector)

// Puts the caret at offset in the first text node of the element.
function caretIn(editor, selector, offset = 0) {
  const r = document.createRange()
  const el = $(selector)
  r.setStart(el.firstChild ?? el, offset)
  editor.selection.setRng(r)
}

function select(editor, startSel, startOffset, endSel, endOffset) {
  const r = document.createRange()
  r.setStart($(startSel).firstChild, startOffset)
  r.setEnd($(endSel).firstChild, endOffset)
  editor.selection.setRng(r)
}

describe('normalize', () => {
  it('collapses whitespace and trims', () => {
    expect(normalize('  a \n\n b\tc ')).toBe('a b c')
  })
})

describe('textToHtml', () => {
  it('escapes HTML in a single line', () => {
    expect(textToHtml('a <b> & c')).toBe('a &lt;b&gt; &amp; c')
  })

  it('turns single newlines into <br>', () => {
    expect(textToHtml('one\ntwo')).toBe('one<br>two')
  })

  it('turns blank-line-separated text into paragraphs', () => {
    expect(textToHtml('one\n\ntwo\nthree')).toBe('<p>one</p><p>two<br>three</p>')
  })
})

describe('fileName', () => {
  it('returns the last path segment for Windows and POSIX paths', () => {
    expect(fileName('C:\\docs\\essay.html')).toBe('essay.html')
    expect(fileName('/home/me/essay.html')).toBe('essay.html')
  })

  it('falls back to Untitled', () => {
    expect(fileName('')).toBe('Untitled')
  })
})

describe('getLineBeforeCaret (Enter to improve)', () => {
  it('returns the paragraph text up to the caret', () => {
    const editor = fakeEditor('<p id="a">hello world</p>')
    caretIn(editor, '#a', 5)
    const target = getLineBeforeCaret(editor)
    expect(target.text).toBe('hello')
    expect(target.range.toString()).toBe('hello')
  })

  it('only returns the last Shift+Enter line', () => {
    const editor = fakeEditor('<p id="a">first line<br><span id="s">second line</span></p>')
    caretIn(editor, '#s', 'second line'.length)
    expect(getLineBeforeCaret(editor).text).toBe('second line')
  })

  it('returns null on an empty line', () => {
    const editor = fakeEditor('<p id="a"><br></p>')
    caretIn(editor, '#a', 0)
    expect(getLineBeforeCaret(editor)).toBeNull()
  })
})

describe('getActionTarget (AI buttons)', () => {
  it('uses the selected text', () => {
    const editor = fakeEditor('<p id="a">cats is nice</p>')
    select(editor, '#a', 0, '#a', 4)
    expect(getActionTarget(editor).text).toBe('cats')
  })

  it('keeps paragraph breaks in a multi-paragraph selection', () => {
    const editor = fakeEditor('<p id="a">cats is nice.</p><p id="b">dogs is loud.</p>')
    select(editor, '#a', 0, '#b', 'dogs is loud.'.length)
    const target = getActionTarget(editor)
    expect(target.text).toBe('cats is nice.\n\ndogs is loud.')
    expect(target.range.toString()).toBe('cats is nice.dogs is loud.')
  })

  it('uses the whole paragraph the caret is in when nothing is selected', () => {
    const editor = fakeEditor('<p id="a">first</p><p id="b">cats is nice</p>')
    caretIn(editor, '#b', 2)
    expect(getActionTarget(editor).text).toBe('cats is nice')
  })

  it('falls back to the nearest line above when the caret line is empty', () => {
    const editor = fakeEditor('<p>first</p><p>cats is nice</p><p id="empty"><br></p>')
    caretIn(editor, '#empty', 0)
    expect(getActionTarget(editor).text).toBe('cats is nice')
  })

  it('uses the last line when the caret is outside the editor', () => {
    const editor = fakeEditor('<p>first</p><p>last line</p><p><br></p>')
    caretIn(editor, '#ui p', 0)
    expect(getActionTarget(editor).text).toBe('last line')
  })

  it('ignores a selection outside the editor', () => {
    const editor = fakeEditor('<p>only line</p>')
    select(editor, '#ui p', 0, '#ui p', 3)
    expect(getActionTarget(editor).text).toBe('only line')
  })

  it('counts a list item holding a paragraph once', () => {
    const editor = fakeEditor('<ul><li><p id="a">item text</p></li></ul>')
    caretIn(editor, '#a', 0)
    const target = getActionTarget(editor)
    expect(target.text).toBe('item text')
    expect(target.range.startContainer).toBe($('#a'))
  })

  it('returns null for an empty document', () => {
    const editor = fakeEditor('<p id="a"><br></p>')
    caretIn(editor, '#a', 0)
    expect(getActionTarget(editor)).toBeNull()
  })
})

describe('findReplaceRange (Replace)', () => {
  function suggestionFor(target) {
    return { original: target.text, range: target.range, rangeText: target.range.toString() }
  }

  it('returns the saved range when the text is unchanged', () => {
    const editor = fakeEditor('<p id="a">cats is nice</p>')
    caretIn(editor, '#a', 0)
    const s = suggestionFor(getActionTarget(editor))
    expect(findReplaceRange(editor, s)).toBe(s.range)
  })

  it('works for a multi-paragraph selection', () => {
    const editor = fakeEditor('<p id="a">cats is nice.</p><p id="b">dogs is loud.</p>')
    select(editor, '#a', 0, '#b', 'dogs is loud.'.length)
    const s = suggestionFor(getActionTarget(editor))
    expect(findReplaceRange(editor, s)).toBe(s.range)
  })

  it('refuses when the text was edited after asking', () => {
    const editor = fakeEditor('<p id="a">cats is nice</p>')
    caretIn(editor, '#a', 0)
    const s = suggestionFor(getActionTarget(editor))
    $('#a').firstChild.textContent = 'cats is nice and I changed it'
    expect(findReplaceRange(editor, s)).toBeNull()
  })

  it('finds the paragraph again when its nodes were rebuilt', () => {
    const editor = fakeEditor('<p id="a">cats is nice</p>')
    caretIn(editor, '#a', 0)
    const s = suggestionFor(getActionTarget(editor))
    // Replace the paragraph with an identical copy, as TinyMCE sometimes does.
    $('#a').replaceWith($('#a').cloneNode(true))
    expect(s.range.toString()).toBe('')

    const range = findReplaceRange(editor, s)
    expect(range).not.toBeNull()
    expect(range.startContainer).toBe($('#a'))
    expect(range.toString()).toBe('cats is nice')
  })

  it('refuses when the rebuilt text matches more than one paragraph', () => {
    const editor = fakeEditor('<p id="a">same</p><p>same</p>')
    caretIn(editor, '#a', 0)
    const s = suggestionFor(getActionTarget(editor))
    $('#a').replaceWith($('#a').cloneNode(true))
    expect(findReplaceRange(editor, s)).toBeNull()
  })
})

describe('widenToBlock', () => {
  function rangeOver(selector) {
    const r = document.createRange()
    r.selectNodeContents($(selector))
    return r
  }

  it('widens to the whole block for multi-paragraph HTML', () => {
    const editor = fakeEditor('<p id="a">cats is nice</p>')
    const range = widenToBlock(editor, rangeOver('#a'), '<p>one</p><p>two</p>')
    expect(range.startContainer).toBe(editor.getBody())
    expect(range.cloneContents().firstChild.nodeName).toBe('P')
  })

  it('leaves the range alone for single-paragraph HTML', () => {
    const editor = fakeEditor('<p id="a">cats is nice</p>')
    const range = widenToBlock(editor, rangeOver('#a'), 'Cats are nice.')
    expect(range.startContainer).toBe($('#a'))
  })

  it('leaves a partial selection alone', () => {
    const editor = fakeEditor('<p id="a">cats is nice</p>')
    const r = document.createRange()
    r.setStart($('#a').firstChild, 0)
    r.setEnd($('#a').firstChild, 4)
    widenToBlock(editor, r, '<p>one</p><p>two</p>')
    expect(r.toString()).toBe('cats')
  })
})
