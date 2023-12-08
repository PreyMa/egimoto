import express from 'express'
import helmet from 'helmet'
import SSE from 'express-sse'
import compression from 'compression'
import dotenv from 'dotenv'
import mqtt from 'mqtt'

dotenv.config()

async function mqttConnect() {
  try {
    const client = await mqtt.connectAsync(process.env.MQTT_HOST, {
      clientId: process.env.MQTT_CLIENT,
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASSWORD
    });

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
app.use(express.static('./static', { index: ['index.html'] }))

const stream= new SSE()
app.get('/stream', stream.init)

client?.on('message', (topic, payload) => {
  if( topic !== process.env.MQTT_TOPIC ) {
    return
  }

  try {
    stream.send( JSON.parse( payload.toString('utf8') ) )
  } catch( e ) {
    console.error('Could not decode mqtt message', e)
  }
})

const port= parseInt(process.env.PORT)
app.listen(port, () => {
  console.log(`HTTP: Server listening on ${port}`)
})
