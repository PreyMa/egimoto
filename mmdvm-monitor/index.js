import dotenv from 'dotenv'
import mqtt from 'mqtt'
import { Tail } from 'tail'
import providers from './providers.js'

dotenv.config()

// Connect to the mqtt server with username and password
const client = await mqtt.connectAsync(process.env.MQTT_HOST, {
  clientId: process.env.MQTT_CLIENT,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
  rejectUnauthorized: false
})

console.log('[MQTT] Connected to server')

// Setup event listeners for errors or reconnect
client.on("reconnect", () => {
  console.error('[MQTT] Reconnected to server')
}).on('error', error => {
  console.error('[MQTT] Error:', error)
})

const tail = new Tail(process.env.LOG_FILE);

tail.on('error', e => {
  console.error('Caught error while reading line:', e)
}).on("line", line => {
  line= line.trim()
  if( !line ) {
    return
  }

  for( const provider of providers ) {
    const packet= provider.tryConsumeLine( line )
    if( packet ) {
      client.publish(process.env.MQTT_TOPIC, JSON.stringify(packet))
      break
    }
  }
});

