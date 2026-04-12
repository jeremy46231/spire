import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, unlinkSync } from 'fs'
import AdmZip from 'adm-zip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = resolve(__dirname, '../../.spire/server-template')
const OUTPUT = resolve(__dirname, '../../.spire/server.zip')

if (!existsSync(TEMPLATE_DIR)) {
  console.error(`[compress] ${TEMPLATE_DIR} does not exist`)
  process.exit(1)
}

console.log('[compress] Packing .spire/server-template/ -> .spire/server.zip')

if (existsSync(OUTPUT)) {
  console.log('[compress] Removing existing output file')
  unlinkSync(OUTPUT)
}

const zip = new AdmZip()
zip.addLocalFolder(TEMPLATE_DIR)
zip.writeZip(OUTPUT)

console.log('[compress] Done')
