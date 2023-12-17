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
import { readVersionNumber } from './version.js'

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

/**
 * The following setup prevents calls from going on indefinitely when there is a mismatch of start and
 * end packets. This can happen (frequently) when the system receives a start packet, but no end packet.
 * However, as DMR only allows one speaker at a time, we can safely assume that a call has ended when a  
 * start packet for a different one comes in. 
 * This is a bit more complicated by the fact, that the DMR system can broadcast the same speaker on
 * different time slots concurrently. Therefore, instead of only remembering the currently open call, we
 * store a list of all calls started with the same 'from' and 'to' fields. Whenever an end packet comes
 * in that matches a packet in the list, we remove it from the list. In case a start packet arrives that
 * does not match the list, we assume that we lost at least one end packet and generate the end packets
 * ourselves on the fly and empty the list. The new start packet is then again added to the list.
 */
const openCalls= []
function handleOpenCalls( packet ) {
  if( packet.action === 'start' ) {
    // Close any other open start packets if they do not have the same 'from' and 'to' fields
    // The list therefore only contains packets with the same fields, so we can just compare with the first item
    if( openCalls.length && packet.action === 'start' && !packetsHaveSameCall(openCalls[0], packet) ) {
      openCalls.forEach( startPacket => {
        const stopPacket= {...startPacket}
        stopPacket.time= new Date().toISOString()
        stopPacket.action= 'end'
        transmitPacket( stopPacket )
        
        console.log(`[Stream] Generated missing stop packet: from ${stopPacket.from} -> to ${stopPacket.to}`)
      })

      openCalls.length= 0
    }
    
    // Remember this start packet for manually closing later if necessary
    openCalls.push( packet )
  }

  // Remove start packets from the open list if an incoming end packet matches the 'from', 'to' and 'typ(e)' fields
  if( openCalls.length && packet.action === 'end' && packetsHaveSameCall(openCalls[0], packet) ) {
    for( let i= 0; i < openCalls.length; i++ ) {
      const startPacket= openCalls[i]
      if( (startPacket.typ || startPacket.type) === (packet.typ || packet.type) ) {
        openCalls.splice(i, 1)
        i--
      }
    }
  }
}

// Read the caller id names CSV and connect to mqtt in parallel
const [callerIdNames, client, versionNumber]= await Promise.all([ readCallerIdNames(), mqttConnect(), readVersionNumber(currentDirectory) ])

const app = express()

// Setup handlebars views directory and file extension
app.engine('hbs', engine({defaultLayout: 'main', extname: '.hbs'}))
app.set('view engine', 'hbs')
app.set('views', path.join(currentDirectory, '/views'))

app.locals.version= versionNumber
app.locals.repeaterCallSign= process.env.REPEATER_CALL_SIGN

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
    packet.time= new Date().toISOString()
    packet.fromName= callerIdNames.get( parseInt(packet.from) ) || ''

    // Only translate private call (PC) caller ids to names
    const [callType, toField]= packet.to.split(' ')
    if( callType && callType.toUpperCase() === 'PC') {
      const toFieldName= callerIdNames.get( parseInt(toField) )
      packet.toName= toFieldName ? `${callType} ${toFieldName}` : ''
    }

    handleOpenCalls( packet )
    transmitPacket( packet )

  } catch( e ) {
    console.error('Could not decode mqtt message', e)
  }
})

const port= parseInt(process.env.PORT)
app.listen(port, () => {
  console.log(`[HTTP] Server listening on ${port}`)
})
