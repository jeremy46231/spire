import { broadcast } from '../../web/server.js'

export function log(line) {
  console.log(line)
  broadcast('log', { line })
}
