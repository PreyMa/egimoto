import express from 'express'
import helmet from 'helmet'
import SSE from 'express-sse'
import compression from 'compression'
import dotenv from 'dotenv'
import url from 'node:url'
import path from 'node:path'
import { mqttConnect } from './mqtt.js'

dotenv.config()

const currentDirectory= url.fileURLToPath( new URL('.', import.meta.url) )
const maxPacketHistoryLength= parseInt(process.env.MAX_PACKET_HISTORY_LENGTH)
const packetHistory= []




const client= await mqttConnect()

const app = express()

app.use(helmet())
app.use(compression())
app.use(express.static(path.join(currentDirectory, '/static'), { index: ['index.html'] }))

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
    const packet= {
      ...JSON.parse( jsonString ),
      time: new Date().toISOString()
    }
    stream.send( packet )

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
