import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import AdmZip from 'adm-zip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = resolve(__dirname, '../../.spire/server')
const ARCHIVE = resolve(__dirname, '../../.spire/server.zip')

const DOWNLOAD_URL = 'https://files.jer.app/share/2026-04-spire/server.zip'

if (existsSync(SERVER_DIR)) {
  console.log('[setup] .spire/server/ already exists, skipping')
  process.exit(0)
}

mkdirSync(resolve(__dirname, '../../.spire'), { recursive: true })

// use local archive if it exists, otherwise download
if (existsSync(ARCHIVE)) {
  console.log('[setup] Using local .spire/server.zip')
} else {
  console.log(`[setup] Downloading ${DOWNLOAD_URL}`)
  const res = await fetch(DOWNLOAD_URL)
  if (!res.ok)
    throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  writeFileSync(ARCHIVE, Buffer.from(await res.arrayBuffer()))
  console.log('[setup] Download complete')
}

console.log('[setup] Extracting to .spire/server/')
mkdirSync(SERVER_DIR, { recursive: true })

const zip = new AdmZip(ARCHIVE)
zip.extractAllTo(SERVER_DIR, true)

console.log('[setup] Done')
