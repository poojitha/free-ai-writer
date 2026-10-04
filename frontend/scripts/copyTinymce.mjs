import fse from 'fs-extra'
import path from 'path'

const topDir = import.meta.dirname
const target = path.join(topDir, '..', 'public', 'tinymce')

fse.emptyDirSync(target)
fse.copySync(
  path.join(topDir, '..', 'node_modules', 'tinymce'),
  target,
  { overwrite: true }
)

console.log('Copied tinymce assets to public/tinymce')
