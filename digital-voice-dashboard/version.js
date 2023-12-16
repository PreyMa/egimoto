
import fs from 'node:fs/promises'
import path from 'node:path'

export async function readVersionNumber( baseDir ) {
  const file= await fs.readFile(path.join( baseDir, '/package.json'), 'utf-8')
  return JSON.parse(file).version
}
