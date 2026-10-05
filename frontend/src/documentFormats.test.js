import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { exportDocument, formatFromPath, imageSize, importDocument, plainTextToHtml } from './documentFormats.js'

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

describe('images', () => {
  // 1×1 PNG and GIF files.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

  it('reads image sizes from PNG, GIF and JPEG headers', () => {
    expect(imageSize(bytes(PNG), 'png')).toEqual({ width: 1, height: 1 })
    expect(imageSize(bytes(GIF), 'gif')).toEqual({ width: 1, height: 1 })
    // SOI, an APP0 segment to skip, then SOF0 with height 32 and width 64.
    const jpeg = new Uint8Array(24)
    jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40])
    expect(imageSize(jpeg, 'jpg')).toEqual({ width: 64, height: 32 })
    expect(imageSize(new Uint8Array(4), 'png')).toBeNull()
  })

  it('embeds images in Word files, sized and with alt text, and opens them back', async () => {
    const html = `<p>Before</p><p><img src="data:image/png;base64,${PNG}" alt="A dot" width="40" height="20"></p>`
    const base64 = await exportDocument('docx', html, '')

    const zip = await JSZip.loadAsync(base64, { base64: true })
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true)
    const xml = await zip.file('word/document.xml').async('string')
    expect(xml).toContain('descr="A dot"')
    // 40×20px in EMUs (9525 per pixel).
    expect(xml).toContain(`cx="${40 * 9525}" cy="${20 * 9525}"`)

    const opened = await importDocument('pic.docx', base64)
    expect(opened).toContain('<p>Before</p>')
    expect(opened).toMatch(/<img [^>]*src="data:image\/png;base64,/)
  })

  it('keeps an image that sits between blocks, and shrinks wide ones to the page', async () => {
    const html = `<p>Text</p><img src="data:image/png;base64,${PNG}" width="1248">`
    const xml = await docxXml(await exportDocument('docx', html, ''))
    // Shrunk to 624px wide, keeping the 1:1 ratio.
    expect(xml).toContain(`cx="${624 * 9525}" cy="${624 * 9525}"`)
  })

  it('leaves out images Word cannot embed', async () => {
    const html = '<p>Hi <img src="https://example.com/cat.png"><img src="data:image/webp;base64,AAAA"></p>'
    const xml = await docxXml(await exportDocument('docx', html, ''))
    expect(xml).toContain('Hi')
    expect(xml).not.toContain('<w:drawing>')
  })

  it('keeps images in HTML files', async () => {
    const html = `<p><img src="data:image/png;base64,${PNG}" alt="A dot"></p>`
    expect(await importDocument('page.html', await exportDocument('html', html, ''))).toContain(PNG)
  })
})
