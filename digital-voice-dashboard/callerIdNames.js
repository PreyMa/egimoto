import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'

export async function readCallerIdNames() {
  return new Promise((res, rej) => {
    // Read whole file line by line
    const readlineInterface= createInterface({
      input: createReadStream( process.env.CALLER_ID_NAMES_FILE),
      terminal: false
    })

    // Read caller id-name-pairs from CSV
    const map= new Map()
    readlineInterface.on('error', rej).on('close', () => {
      console.log(`[CSV] Read ${map.size} entries`)
      res(map)
    }).on('line', line => {
      // Ignore empty lines
      line= line.trim()
      if( !line ) {
        return
      }

      // Split out the line as <id integer>;<name>;
      const delimIdx= line.indexOf(';')
      const id= parseInt(line.substring(0, delimIdx))
      const name= line.substring(delimIdx+1, line.lastIndexOf(';')).trim()

      // Ignore invalid lines
      if( !Number.isInteger(id) || !name.length || name.indexOf(';') !== -1 ) {
        console.error(`[CSV] Invalid callerid line: ${line}`)
        return
      }

      map.set(id, name)
    })
  })
}
