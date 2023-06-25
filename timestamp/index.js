// Simple timestamp service

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import express from 'express'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import * as uuid from 'uuid'
import joi from 'joi'
import helmet from 'helmet'
import cors from 'cors'
import {HttpError} from 'http-errors'
import logging from 'mqtt-logger'

const dirName= url.fileURLToPath(new URL('.', import.meta.url))

dotenv.config()

// Setup logging
const mqttLoggingOptions= {
  broker: process.env.MQTT_BROKER,
  client: process.env.MQTT_CLIENT,
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  path: process.env.MQTT_TOPIC
}

logging.LoggerConfig.the().init(
  new logging.ConsoleSink(),
  new logging.MqttSink(mqttLoggingOptions),
  new logging.FileSink({directory: './logs'})
)
const logger= new logging.Logger({name: 'timestamp', color: logging.Logger.Colors.green})

function createKeyPair() {
  logger.log('Creating new key pair...')

  // Create new key pair
  const keys= crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })

  // Create timestamp and unique id
  const id= uuid.v4()
  const time= Date.now()
  const hexTime= time.toString(16)

  // Write the keys to disk
  const publicKeyPath= path.join( process.env.KEYS_DIR, `${hexTime}.${id}.public.pem` )
  const publicKeyPem= keys.publicKey.export({type: 'pkcs1', format: 'pem'})
  fs.writeFileSync( publicKeyPath, publicKeyPem )

  const privateKeyPath= path.join( process.env.KEYS_DIR, `${hexTime}.${id}.private.pem` )
  fs.writeFileSync( privateKeyPath, keys.privateKey.export({type: 'pkcs1', format: 'pem'}) )

  return {
    uuid: id,
    time,
    private: keys.privateKey,
    public: keys.publicKey,
    publicKeyPem
  }
}

const keyPairMaxAge= parseInt(process.env.KEY_PAIR_MAX_AGE)* 24* 60* 60* 1000
function loadKeys() {
  const keysMap= new Map()

  // Go through the directory of keys and take each file that has a filename
  // matching the required schema. Each file is added to a map of key pairs.
  const keysDirectory= fs.opendirSync(process.env.KEYS_DIR)
  let dirEntry= null
  try {
    while((dirEntry = keysDirectory.readSync()) !== null) {
      // Try to match the file name to the schema
      const nameSplitter= /^(?<time>[0-9a-fA-F]+)\.(?<uuid>[0-9a-fA-F]{8}[-:][0-9a-fA-F]{4}[-:][0-9a-fA-F]{4}[-:][0-9a-fA-F]{4}[-:][0-9a-fA-F]{12})\.(?<type>private|public)\.pem$/
      const match= dirEntry.name.match(nameSplitter)
      if( match ) {
        // Extract all information from the file name string
        const uuid= match.groups.uuid
        const time= parseInt(match.groups.time, 16)
        const type= match.groups.type
  
        // Get or create map entry
        let mapEntry= keysMap.get(uuid)
        if(!mapEntry) {
          mapEntry= {uuid, time}
          keysMap.set(uuid, mapEntry)
        }
  
        if(mapEntry.time !== time) {
          throw Error(`Key files '${uuid}' have mismatching times`)
        }
  
        if( mapEntry.hasOwnProperty(type) ) {
          throw Error(`Key files '${uuid}' have multiple files for each key file type`)
        }
  
        // Add the file path to the entry by key file type
        mapEntry[type]= path.join(process.env.KEYS_DIR, dirEntry.name)
      }
    }
  } finally {
    keysDirectory.close()
  }

  // Iterate over all entries to find the newest by its time. Also check
  // if all entries have both key file types
  let newestKeyPair= null
  for(const [uuid, entry] of keysMap) {
    if( !entry.private || !entry.public ) {
      throw Error(`Key files '${uuid} is missing a key file type (private or public)'`)
    }

    if( newestKeyPair === null || newestKeyPair.time < entry.time) {
      newestKeyPair= entry
    }
  }

  // Create a new key pair if the newest key pair is too old
  if( newestKeyPair === null || Date.now() - newestKeyPair.time > keyPairMaxAge) {
    const newKeyEntry= createKeyPair()
    keysMap.set(newKeyEntry.uuid, newKeyEntry)
    newestKeyPair= newKeyEntry
  }

  // Load the public keys for all entries and remove the private keys. Only
  // the newest entry loads its private key
  for(const [uuid, entry] of keysMap) {
    // Skip the entry if it already has its keys loaded
    if(typeof entry.public !== 'string' && typeof entry.private !== 'string') {
      continue
    }

    entry.publicKeyPem= fs.readFileSync(entry.public, 'utf8')
    entry.public= crypto.createPublicKey( entry.publicKeyPem )

    if(entry === newestKeyPair) {
      entry.private= crypto.createPrivateKey( fs.readFileSync(entry.private) )
    } else {
      entry.private= null
    }
  }

  // console.log(keysMap)
  logger.log(`Loaded ${keysMap.size} keys. Current key pair is '${newestKeyPair.uuid}'`)

  return { keysMap, newestKeyPair }
}

function loadPages() {
  return {
    homePage: fs.readFileSync(process.env.HOME_PAGE || path.join(dirName, 'index.html'), 'utf8'),
    error404Page: fs.readFileSync(process.env.ERROR_404_PAGE || path.join(dirName, '404.html'), 'utf8'),
    error500Page: fs.readFileSync(process.env.ERROR_500_PAGE || path.join(dirName, '500.html'), 'utf8')
  }
}

function createTicket(customData) {
  const content= {
    uuid: uuid.v4(),
    issuer: process.env.ISSUER_ID,
    timestamp: new Date().toISOString(),
    type: 'v1',
    cert: currentKeyPair.uuid,
    customData
  }

  const sign = crypto.createSign('SHA256')
  sign.write(JSON.stringify(content))
  sign.end()

  const signature = sign.sign(currentKeyPair.private, 'base64')
  return { content, signature }
}

const validationOptions= {
  abortEarly: process.env.ALL_VALIDATION_ERRORS.toLowerCase() !== 'true'
}

const ticketSchema= joi.object({
  content: joi.object({
    uuid: joi.string().uuid({version: 'uuidv4'}).required(),
    issuer: joi.string().equal(process.env.ISSUER_ID).required(),
    timestamp: joi.string().isoDate().required(),
    type: joi.string().equal('v1').required(),
    cert: joi.string().uuid({version: 'uuidv4'}).required(),
    customData: joi.object().unknown(true).required()
  }).required(),
  signature: joi.string().base64().length(344).required()
})

function verifyTicket(ticket) {
  // Validate schema
  const result= ticketSchema.validate(ticket, validationOptions)
  if( result.error ) {
    let message= 'unknown error'
    if( result.error.details.length ) {
      message= result.error.details.map(err => err.message).join('\n')
    }
    return { error: `Schema error: ${message}`}
  }

  // Get key pair entry
  const keyPair= keysMap.get(ticket.content.cert)
  if(!keyPair) {
    return { error: 'Unknown cert id' }
  }

  // Verify signature
  const verify = crypto.createVerify('SHA256')
  verify.write(JSON.stringify(ticket.content))
  verify.end()
  const isValid= verify.verify(keyPair.public, ticket.signature, 'base64')
  return {error: isValid ? null : 'Signature error'}
}

// Load the keys and pages
const maxNumCustomDataBytes= parseInt(process.env.CUSTOM_DATA_LIMIT);
const {keysMap, newestKeyPair}= loadKeys()
const {homePage, error404Page, error500Page}= loadPages()

// Add handler to automatically update the keys
let currentKeyPair= newestKeyPair;
setInterval(() => {
  // Check age every 10 minutes
  if(Date.now() -currentKeyPair.time > keyPairMaxAge ) {
    const newKeyEntry= createKeyPair()
    keysMap.set(newKeyEntry.uuid, newKeyEntry)

    // Release the private key of the old key entry
    currentKeyPair.private= null
    currentKeyPair= newKeyEntry
  }
}, 10* 60* 1000)

let numTicketsIssued= 0n, numTicketsIssuedPrev= 0n
let numTicketsVerified= 0n, numTicketsVerifiedPrev= 0n
let numPageVisits= 0n, numPageVisitsPrev= 0n

// Add handler to send stat messages in regular intervals
setInterval(() => {
  // Send stats every 5 minutes
  logger.stats(
    {issued: numTicketsIssued- numTicketsIssuedPrev}, ` issued (${numTicketsIssued} total),`,
    {verified: numTicketsVerified- numTicketsVerifiedPrev}, ` verified (${numTicketsVerified} total),`,
    {tickets: numPageVisits- numPageVisitsPrev}, ` visits (${numPageVisits} total),`
  )

  numTicketsIssuedPrev= numTicketsIssued
  numTicketsVerifiedPrev= numTicketsVerified
  numPageVisitsPrev= numPageVisits
}, 5* 60* 1000)

// Create the express app
const app= express()
app.use(express.static(process.env.PUBLIC_DIR || path.join(dirName,'public')))
app.use(helmet())
app.use(cors())
app.use(bodyParser.json({limit: maxNumCustomDataBytes+ 600}))

// Homepage
app.get('/', (req, res) => {
  res.send(homePage)
  numPageVisits++
})

// API -> /cert returns the requested public key as PEM file string
app.get('/v1/api/cert/:uuid?', (req, res) => {
  const keyPair= req.params.uuid ? keysMap.get(req.params.uuid) : currentKeyPair
  if(!keyPair) {
    res
    .type('text/plain')
    .status(404)
    .send('Unknown key id')  
    return
  }

  res
    .type('text/plain')
    .send(keyPair.publicKeyPem)
})

// API -> /ticket returns a new timestamp ticket as JSON
app.get('/v1/api/ticket', (req, res) => {
  const queryBegin= req.url.indexOf('?')
  const queryLength= req.url.length - (queryBegin < 0 ? req.url.length : (queryBegin+1))
  if(queryLength > maxNumCustomDataBytes) {
    res
    .status(414)
    .type('text/plain')
    .send('invalid\n\nRequest error: payload too large')
  }

  const customData= req.query || {}
  const ticket= createTicket(customData)
  res.json(ticket)

  numTicketsIssued++
})

// API -> /verify checks a ticket and returns errors as plain text
app.post('/v1/api/verify', (req, res) => {
  const result= verifyTicket(req.body)
  res
    .status(result.error ? 422 : 200)
    .type('text/plain')
    .send(result.error ? `invalid\n\n${result.error}` : 'ok')

  numTicketsVerified++
})

// API -> Send 404 error as plain text
app.get('/v1/*', (req, res) => {
  res
    .status(404)
    .type('text/plain')
    .send(`Error: Unknown api route "${req.url}"`)
})

// Any other 404 error is sent as an html page
app.get('*', (req, res) => {
  res.send(error404Page)
})

// Error handler that either sends a plain text error for
// API routes, or sends an html error page
app.use((err, req, res, next) => {
  logger.error(`Caught error on url '${req.url}'`);

  // Plain text error for api endpoint
  if( req.url.startsWith('/v1/api') ) {
    if(err instanceof HttpError && err.status === 413) {

      let resultLine= ''
      if(req.url.startsWith('/v1/api/verify')) {
        resultLine= 'invalid\n\n'
      }

      res
        .type('text/plain')
        .status(err.status)
        .send(resultLine+ 'Request error: payload too large')
      return
    }
    
    res
      .status(500)
      .send('internal error')

  // Html error page for anything else
  } else {
    res.send(error500Page)
  }
  next(err)
})

// Run the app
app.listen(parseInt(process.env.PORT), () => {
  logger.log(`App running on port ${process.env.port}`)
})
