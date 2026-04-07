import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { decompress } from 'fzstd'
import * as tar from 'tar'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = resolve(__dirname, '../.spire/server')
const ARCHIVE = resolve(__dirname, '../.spire/server.tar.zst')

const DOWNLOAD_URL = 'https://files.jer.app/share/2026-04-spire/server.tar.zst'

if (existsSync(SERVER_DIR)) {
  console.log('[setup] .spire/server/ already exists, skipping')
  process.exit(0)
}

mkdirSync(resolve(__dirname, '../.spire'), { recursive: true })

// use local archive if it exists, otherwise download
if (existsSync(ARCHIVE)) {
  console.log('[setup] Using local .spire/server.tar.zst')
} else {
  console.log(`[setup] Downloading ${DOWNLOAD_URL}`)
  const res = await fetch(DOWNLOAD_URL)
  if (!res.ok)
    throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  writeFileSync(ARCHIVE, Buffer.from(await res.arrayBuffer()))
  console.log('[setup] Download complete')
}

console.log('[setup] Decompressing...')
const compressed = readFileSync(ARCHIVE)
const tarData = Buffer.from(decompress(compressed))

mkdirSync(SERVER_DIR, { recursive: true })

console.log('[setup] Extracting to .spire/server/')
await pipeline(Readable.from(tarData), tar.x({ cwd: SERVER_DIR }))

console.log('[setup] Done')
