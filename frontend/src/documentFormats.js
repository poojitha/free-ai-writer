// Converting the editor's HTML to and from the file formats Save/Open
// support. Files cross to Go as base64 (Wails' encoding for []byte); the
// format is chosen by the file's extension.

export function formatFromPath(path) {
  const ext = path.toLowerCase().split('.').pop()
  if (ext === 'docx') return 'docx'
  if (ext === 'txt') return 'txt'
  return 'html'
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const textToBase64 = (text) => bytesToBase64(new TextEncoder().encode(text))
const base64ToText = (base64) => new TextDecoder().decode(base64ToBytes(base64))

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Plain text → editor HTML: blank lines separate paragraphs, single newlines
// become <br>.
export function plainTextToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Saved HTML is a full page (so browsers and Word read it as UTF-8); older
// files are bare fragments. Either way the editor wants the body's contents.
function htmlFileToEditorHtml(text) {
  return new DOMParser().parseFromString(text, 'text/html').body.innerHTML
}

function editorHtmlToHtmlFile(html) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Document</title>
</head>
<body>
${html}
</body>
</html>
`
}

// Returns base64 file contents for the editor's HTML (and its plain-text
// rendering, used for .txt).
export async function exportDocument(format, html, text) {
  if (format === 'docx') return htmlToDocxBase64(html)
  if (format === 'txt') return textToBase64(text)
  return textToBase64(editorHtmlToHtmlFile(html))
}

// Returns editor HTML for a file's base64 contents.
export async function importDocument(path, base64) {
  const format = formatFromPath(path)
  if (format === 'docx') {
    const { default: mammoth } = await import('mammoth')
    const bytes = base64ToBytes(base64)
    const { value } = await mammoth.convertToHtml(
      // The browser build (bundled by Vite) reads arrayBuffer; the Node
      // build (used by Vitest) reads buffer.
      { arrayBuffer: bytes.buffer, buffer: bytes },
      // Mammoth drops underline and strikethrough unless mapped.
      { styleMap: ['u => u', 'strike => s'] },
    )
    return value
  }
  if (format === 'txt') return plainTextToHtml(base64ToText(base64))
  return htmlFileToEditorHtml(base64ToText(base64))
}

// ---- HTML → .docx ----

const HEADINGS = { H1: 'HEADING_1', H2: 'HEADING_2', H3: 'HEADING_3', H4: 'HEADING_4', H5: 'HEADING_5', H6: 'HEADING_6' }
const ALIGNMENTS = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' }
const ORDERED_LIST = 'ordered-list'

async function htmlToDocxBase64(html) {
  const docx = await import('docx')
  const body = new DOMParser().parseFromString(html, 'text/html').body
  // Each <ol> gets its own numbering instance so it restarts at 1.
  let nextListInstance = 0

  // Inline content → TextRuns (and hyperlinks).
  function runs(node, marks) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/[ \t\r\n]+/g, ' ')
      if (!text) return []
      return [new docx.TextRun({
        text,
        bold: marks.bold,
        italics: marks.italics,
        underline: marks.underline ? {} : undefined,
        strike: marks.strike,
        font: marks.mono ? 'Consolas' : undefined,
        style: marks.link ? 'Hyperlink' : undefined,
      })]
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    if (node.nodeName === 'BR') return [new docx.TextRun({ break: 1 })]

    const decoration = node.style?.textDecoration ?? ''
    const next = {
      ...marks,
      bold: marks.bold || ['STRONG', 'B'].includes(node.nodeName),
      italics: marks.italics || ['EM', 'I'].includes(node.nodeName),
      underline: marks.underline || node.nodeName === 'U' || decoration.includes('underline'),
      strike: marks.strike || ['S', 'STRIKE', 'DEL'].includes(node.nodeName) || decoration.includes('line-through'),
      mono: marks.mono || node.nodeName === 'CODE',
    }
    const children = [...node.childNodes].flatMap((c) => runs(c, next))
    if (node.nodeName === 'A' && node.getAttribute('href')) {
      return [new docx.ExternalHyperlink({
        link: node.getAttribute('href'),
        children: [...node.childNodes].flatMap((c) => runs(c, { ...next, link: true })),
      })]
    }
    return children
  }

  function paragraph(el, options, marks = {}) {
    const align = ALIGNMENTS[el.style?.textAlign]
    return new docx.Paragraph({
      ...options,
      alignment: align ? docx.AlignmentType[align] : undefined,
      children: [...el.childNodes].flatMap((c) => runs(c, marks)),
    })
  }

  const isList = (n) => n.nodeName === 'UL' || n.nodeName === 'OL'

  function list(el, level, options) {
    const ordered = el.nodeName === 'OL'
    const instance = ordered ? nextListInstance++ : 0
    return [...el.children].filter((li) => li.nodeName === 'LI').flatMap((li) => {
      // The item's own text (including any <p> inside it), then nested lists.
      const inline = document.createElement('div')
      for (const child of li.childNodes) {
        if (isList(child)) continue
        if (child.nodeName === 'P') inline.append(...child.cloneNode(true).childNodes)
        else inline.append(child.cloneNode(true))
      }
      const numbering = ordered
        ? { numbering: { reference: ORDERED_LIST, level, instance } }
        : { bullet: { level } }
      return [
        paragraph(inline, { ...options, ...numbering }),
        ...[...li.children].filter(isList).flatMap((nested) => list(nested, level + 1, options)),
      ]
    })
  }

  // Block content → Paragraphs. Stray inline content between blocks is
  // gathered into its own paragraph.
  function blocks(container, options = {}) {
    const out = []
    let pending = document.createElement('p')
    const flush = () => {
      if (pending.textContent.trim()) out.push(paragraph(pending, options))
      pending = document.createElement('p')
    }
    for (const node of container.childNodes) {
      const name = node.nodeName
      if (name === 'P' || name === 'DIV') { flush(); out.push(paragraph(node, options)) }
      else if (HEADINGS[name]) { flush(); out.push(paragraph(node, { ...options, heading: docx.HeadingLevel[HEADINGS[name]] })) }
      else if (isList(node)) { flush(); out.push(...list(node, 0, options)) }
      else if (name === 'BLOCKQUOTE') {
        flush()
        out.push(...blocks(node, {
          ...options,
          indent: { left: 720 },
          border: { left: { style: docx.BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 12 } },
        }))
      }
      else if (name === 'PRE') { flush(); out.push(paragraph(node, options, { mono: true })) }
      else pending.append(node.cloneNode(true))
    }
    flush()
    return out
  }

  const doc = new docx.Document({
    styles: {
      default: { document: { run: { font: 'Georgia', size: 24 } } },
    },
    numbering: {
      config: [{
        reference: ORDERED_LIST,
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: docx.LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: docx.AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: blocks(body) }],
  })
  return docx.Packer.toBase64String(doc)
}
