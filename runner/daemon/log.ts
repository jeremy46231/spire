import { broadcast } from '../../web/server.js'

export function log(line: string) {
  console.log(line)
  broadcast('log', { line })
}
