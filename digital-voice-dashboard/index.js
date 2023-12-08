import express from 'express'
import helmet from 'helmet'
import SSE from 'express-sse'
import compression from 'compression'
import dotenv from 'dotenv'
import mqtt from 'mqtt'
import url from 'node:url'
import path from 'node:path'

dotenv.config()

const currentDirectory= url.fileURLToPath( new URL('.', import.meta.url) )
const maxPacketHistoryLength= parseInt(process.env.MAX_PACKET_HISTORY_LENGTH)
const packetHistory= []

async function mqttConnect() {
  try {
    const client = await mqtt.connectAsync(process.env.MQTT_HOST, {
      clientId: process.env.MQTT_CLIENT,
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASSWORD
    });

    console.log('[MQTT] Connected to server')
    await client.subscribeAsync(process.env.MQTT_TOPIC)
    return client

  } catch( e ) {
    console.error('[MQTT] Could not connect/subscribe to server:', e)
    return null
  }
}

const client= await mqttConnect()

client?.on("reconnect", () => {
  console.error('[MQTT] Reconnected to server')
}).on('error', error => {
  console.error('[MQTT] Error:', error)
})

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
