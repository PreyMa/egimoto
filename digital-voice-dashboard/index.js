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
app.get('/faq/en', (req, res) => res.render('faq_en'))

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

    const toFieldParts= packet.to.split(' ')
    const toFieldName= callerIdNames.get( parseInt(toFieldParts[1]) )
    packet.toName= toFieldName ? `${toFieldParts[0]} ${toFieldName}` : ''

    stream.send( packet )

    // Add packet to the history and delete old ones if necessary
    packetHistory.push( packet )
    while( packetHistory.length > maxPacketHistoryLength ) {
      packetHistory.shift()
    }

  } catch( e ) {
    console.error('Could not decode mqtt message', e)
  }
})

const port= parseInt(process.env.PORT)
app.listen(port, () => {
  console.log(`[HTTP] Server listening on ${port}`)
})
