// Simple timestamp service

import crypto from 'node:crypto'
import fs from 'node:fs'
import express from 'express'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import * as uuid from 'uuid'
import joi from 'joi'
import helmet from 'helmet'
import {HttpError} from 'http-errors'

dotenv.config()

function loadKeys() {
  const privateKey= crypto.createPrivateKey( fs.readFileSync(process.env.PRIVATE_KEY) )
  const publicKey= crypto.createPublicKey( fs.readFileSync(process.env.PUBLIC_KEY) )

  return {privateKey, publicKey}
}

function loadPages() {
  return {
    homePage: fs.readFileSync(process.env.HOME_PAGE, 'utf8'),
    error404Page: fs.readFileSync(process.env.ERROR_404_PAGE, 'utf8'),
    error500Page: fs.readFileSync(process.env.ERROR_500_PAGE, 'utf8')
  }
}

function createTicket(customData) {
  const content= {
    uuid: uuid.v4(),
    issuer: process.env.ISSUER_ID,
    timeStamp: new Date().toISOString(),
    type: 'v1',
    customData
  }

  const sign = crypto.createSign('SHA256')
  sign.write(JSON.stringify(content))
  sign.end()

  const signature = sign.sign(privateKey, 'base64')
  return { content, signature }
}

const validationOptions= {
  abortEarly: process.env.ALL_VALIDATION_ERRORS.toLowerCase() !== 'true'
}

const ticketSchema= joi.object({
  content: joi.object({
    uuid: joi.string().uuid({version: 'uuidv4'}).required(),
    issuer: joi.string().equal(process.env.ISSUER_ID).required(),
    timeStamp: joi.string().isoDate().required(),
    type: joi.string().equal('v1').required(),
    customData: joi.object().unknown(true).required()
  }).required(),
  signature: joi.string().base64().length(344).required()
})

function verifyTicket(ticket) {
  const result= ticketSchema.validate(ticket, validationOptions)
  if( result.error ) {
    let message= 'unknown error'
    if( result.error.details.length ) {
      message= result.error.details.map(err => err.message).join('\n')
    }
    return { error: `Schema error: ${message}`}
  }

  const verify = crypto.createVerify('SHA256')
  verify.write(JSON.stringify(ticket.content))
  verify.end()
  const isValid= verify.verify(publicKey, ticket.signature, 'base64')
  return {error: isValid ? null : 'Signature error'}
}

// Load the keys and pages, and create the express app
const maxNumCustomDataBytes= parseInt(process.env.CUSTOM_DATA_LIMIT);
const {privateKey, publicKey}= loadKeys()
const {homePage, error404Page, error500Page}= loadPages()
const app= express()

app.use(express.static('public'))
app.use(helmet())
app.use(bodyParser.json({limit: maxNumCustomDataBytes+ 600}))

// Homepage
app.get('/', (req, res) => {
  res.send(homePage)
})

// API -> /cert returns the public key as PEM file string
const publicKeyPemString= publicKey.export({type: 'pkcs1', format: 'pem'})
app.get('/v1/api/cert', (req, res) => {
  res
    .type('text/plain')
    .send(publicKeyPemString)
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
})

// API -> /verify checks a ticket and returns errors as plain text
app.post('/v1/api/verify', (req, res) => {
  const result= verifyTicket(req.body)
  res
    .status(result.error ? 422 : 200)
    .type('text/plain')
    .send(result.error ? `invalid\n\n${result.error}` : 'ok')
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
  console.error(`Caught error on url '${req.url}'`);

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
  console.log(`App running on port ${process.env.port}`)
})
