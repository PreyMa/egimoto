import express from 'express'
import helmet from 'helmet'
import SSE from 'express-sse'
import compression from 'compression'
import dotenv from 'dotenv'
import url from 'node:url'
import path from 'node:path'
import { engine } from 'express-handlebars'
import { mqttConnect } from './mqtt.js'
import { readCallerIdNames } from './callerIdNames.js'

dotenv.config()

const currentDirectory= url.fileURLToPath( new URL('.', import.meta.url) )
const maxPacketHistoryLength= parseInt(process.env.MAX_PACKET_HISTORY_LENGTH)
const packetHistory= []

function transmitPacket( packet ) {
  stream.send( packet )

  // Add packet to the history and delete old ones if necessary
  packetHistory.push( packet )
  while( packetHistory.length > maxPacketHistoryLength ) {
    packetHistory.shift()
  }
}

function packetsHaveSameCall( a, b ) {
  return a.to === b.to && a.from === b.from
}

// Read the caller id names CSV and connect to mqtt in parallel
const [callerIdNames, client]= await Promise.all([ readCallerIdNames(), mqttConnect() ])

const app = express()

// Setup handlebars views directory and file extension
app.engine('hbs', engine({defaultLayout: 'main', extname: '.hbs'}))
app.set('view engine', 'hbs')
app.set('views', path.join(currentDirectory, '/views'))

// Add middleware functions
app.use(helmet())
app.use(compression())
app.use(express.static(path.join(currentDirectory, '/static')))

// Setup view routes
app.get('/', (req, res) => res.render('home'))
app.get('/about/en', (req, res) => res.render('about_en'))
app.get('/about/de', (req, res) => res.render('about_de'))
app.get('/faq/en', (req, res) => res.render('faq_en'))
app.get('/faq/de', (req, res) => res.render('faq_de'))

const stream= new SSE()
app.get('/stream', stream.init)
app.get('/history', (req, resp) => resp.send(packetHistory) )

let lastStartPacket= null
client?.on('message', (topic, payload) => {
  if( topic !== process.env.MQTT_TOPIC ) {
    return
  }

  const jsonString= payload.toString('utf8').trim()
  if( !jsonString ) {
    return
  }

  try {
    // Parse the json into an object to add some additional fields
    const packet= JSON.parse( jsonString )
    // Check if this is a start packet while another start packet was not yet ended
    if( lastStartPacket && packet.action === 'start' && !packetsHaveSameCall(lastStartPacket, packet) ) {
      const stopPacket= {...lastStartPacket}
      stopPacket.time= new Date().toISOString()
      stopPacket.action= 'end'
      transmitPacket( stopPacket )
      lastStartPacket= null

      console.log('[Stream] Generated missing stop packet:', stopPacket)
    }

    // End the last start packet if an end packet for the same call comes in
    if( lastStartPacket && packet.action === 'end' && packetsHaveSameCall(lastStartPacket, packet) ) {
      lastStartPacket= null
    }

    packet.time= new Date().toISOString()
    packet.fromName= callerIdNames.get( parseInt(packet.from) ) || ''

    // Only translate private call (PC) caller ids to names
    const [callType, toField]= packet.to.split(' ')
    if( callType && callType.toUpperCase() === 'PC') {
      const toFieldName= callerIdNames.get( parseInt(toField) )
      packet.toName= toFieldName ? `${callType} ${toFieldName}` : ''
    }

    // Remember the last start packet, as it might need to be closed manually later
    if( packet.action === 'start' ) {
      lastStartPacket= packet
    }

    transmitPacket( packet )

  } catch( e ) {
    console.error('Could not decode mqtt message', e)
  }
})

const port= parseInt(process.env.PORT)
app.listen(port, () => {
  console.log(`[HTTP] Server listening on ${port}`)
})
