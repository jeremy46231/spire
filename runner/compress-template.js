import { execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = resolve(__dirname, '../.spire/server-template')
const OUTPUT = resolve(__dirname, '../.spire/server.tar.zst')

if (!existsSync(TEMPLATE_DIR)) {
  console.error(`[compress] ${TEMPLATE_DIR} does not exist`)
  process.exit(1)
}

console.log(
  '[compress] Packing .spire/server-template/ -> .spire/server.tar.zst'
)

// pipe through zstd for cross-platform compat (macOS tar lacks --zstd)
execSync(
  `tar --no-mac-metadata -cf - -C "${TEMPLATE_DIR}" . | zstd -o "${OUTPUT}"`,
  {
    stdio: 'inherit',
  }
)

console.log('[compress] Done')
