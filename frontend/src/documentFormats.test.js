import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { exportDocument, formatFromPath, importDocument, plainTextToHtml } from './documentFormats.js'

const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))

async function docxXml(base64) {
  const zip = await JSZip.loadAsync(base64, { base64: true })
  return zip.file('word/document.xml').async('string')
}

describe('formatFromPath', () => {
  it('picks the format from the extension, case-insensitively', () => {
    expect(formatFromPath('C:\\docs\\essay.docx')).toBe('docx')
    expect(formatFromPath('/home/me/Notes.TXT')).toBe('txt')
    expect(formatFromPath('page.html')).toBe('html')
    expect(formatFromPath('page.htm')).toBe('html')
  })
})

describe('plain text', () => {
  it('turns blank-line-separated text into paragraphs with <br> line breaks', () => {
    expect(plainTextToHtml('one\r\n\r\ntwo\nthree\n\n\n')).toBe('<p>one</p><p>two<br>three</p>')
  })

  it('escapes HTML', () => {
    expect(plainTextToHtml('a <b> & c')).toBe('<p>a &lt;b&gt; &amp; c</p>')
  })

  it('round-trips unicode text', async () => {
    const text = 'Café ☕ — naïve\n\n日本語 🎉'
    const base64 = await exportDocument('txt', '<p>ignored</p>', text)
    expect(decode(base64)).toBe(text)
    expect(await importDocument('notes.txt', base64)).toBe('<p>Café ☕ — naïve</p><p>日本語 🎉</p>')
  })
})

describe('HTML', () => {
  it('saves a full UTF-8 page and opens it back to the body contents', async () => {
    const html = '<h1>Title</h1><p>Café <strong>bold</strong></p>'
    const base64 = await exportDocument('html', html, '')
    const file = decode(base64)
    expect(file).toContain('<meta charset="utf-8">')
    expect(file).toContain(html)
    expect((await importDocument('page.html', base64)).trim()).toBe(html)
  })

  it('opens older files saved as bare fragments', async () => {
    const base64 = btoa('<p>old file</p>')
    expect(await importDocument('old.html', base64)).toBe('<p>old file</p>')
  })
})

describe('Word (.docx)', () => {
  const sample = [
    '<h1>A Quieter Life</h1>',
    '<h2>Section</h2>',
    '<p>Plain, <strong>bold</strong>, <em>italic</em>, ',
    '<span style="text-decoration: underline;">underlined</span> and <s>struck</s>.</p>',
    '<p style="text-align: center;">Centered</p>',
    '<ul><li>bullet one</li><li>bullet two<ul><li>nested</li></ul></li></ul>',
    '<ol><li>first</li><li>second</li></ol>',
    '<ol><li>restart</li></ol>',
    '<blockquote><p>A quote</p></blockquote>',
    '<p>A <a href="https://example.com">link</a><br>after a break</p>',
  ].join('')

  it('produces a Word file that opens back with the same structure', async () => {
    const base64 = await exportDocument('docx', sample, '')
    expect(atob(base64).slice(0, 2)).toBe('PK') // a zip file

    const html = await importDocument('essay.docx', base64)
    expect(html).toContain('<h1>A Quieter Life</h1>')
    expect(html).toContain('<h2>Section</h2>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<u>underlined</u>')
    expect(html).toContain('<s>struck</s>')
    expect(html).toMatch(/<ul><li>bullet one<\/li><li>bullet two<ul><li>nested<\/li><\/ul><\/li><\/ul>/)
    expect(html).toContain('<li>first</li><li>second</li>')
    expect(html).toContain('<a href="https://example.com">link</a>')
    expect(html).toContain('A quote')
    expect(html).toContain('link</a><br />after a break')
  })

  it('keeps alignment and restarts each numbered list', async () => {
    const xml = await docxXml(await exportDocument('docx', sample, ''))
    expect(xml).toContain('<w:jc w:val="center"/>')
    // Two <ol>s → two numbering instances, so the second starts at 1 again.
    const numIds = new Set([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]))
    expect(numIds.size).toBeGreaterThanOrEqual(3) // bullets + two ordered lists
  })

  it('handles an empty document', async () => {
    const base64 = await exportDocument('docx', '', '')
    expect(await importDocument('empty.docx', base64)).toBe('')
  })
})
