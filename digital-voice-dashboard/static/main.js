import langs from './lang.js'

function ifTruthy( value, fn ) { value ? fn(value) : null }

function showErrorModal( message ) {
  document.getElementById('error-message').innerText= message
  document.getElementById('error-modal').showModal()
}

function formatTime( date ) {
  if( !(date instanceof Date) || Number.isNaN(date) ) {
    return ''
  }

  const hours= `${date.getHours()}`.padStart(2, '0')
  const minutes= `${date.getMinutes()}`.padStart(2, '0')
  const seconds= `${date.getSeconds()}`.padStart(2, '0')

  return `${hours}:${minutes}:${seconds}`
}

let lang= null

// Try to reload the language setting from local storage
ifTruthy(
  document.querySelector(`input[type="radio"][name="lang"][value="${localStorage.getItem('lang')}"]`),
  button => button.checked= true
)

// Setup language selector
document.querySelectorAll('input[type="radio"][name="lang"]').forEach( button => {
  function update() {
    if( !button.checked ) {
      return
    }

    lang= langs[button.value]
    if( !lang ) {
      return
    }

    localStorage.setItem('lang', button.value)

    document.querySelectorAll('*[data-lang]').forEach( elem => {
      elem.innerText= lang[elem.getAttribute('data-lang')]
    })
  }

  button.addEventListener('change', update)
  update()
})

// Setup fade-out timer enable/disable button
document.getElementById('keep-entries-checkbox').checked= localStorage.getItem('keepEntries') !== 'false'
document.getElementById('keep-entries-checkbox').addEventListener('change', e => {
  const keepEntries= e.target.checked
  localStorage.setItem('keepEntries', keepEntries)

  if( keepEntries ) {
    Talker.forEach(table, talker => talker.clearFadeoutTimer())
  } else {
    Talker.forEach(table, talker => talker.setFadeoutTimer())
  }
})

class Talker {
  constructor( config ) {
    this.startTime= -1
    this.fadeOutTimer= null
    this.callerId= config.from
    this.tableRow= document.createElement('tr')
    this.tableRow._talkerInstance= this
    
    const activeElem= this.tableRow.appendChild( document.createElement('td') )
    activeElem.classList.add('active')
    activeElem.appendChild( document.createElement('span') )

    const connectionElem= this.tableRow.appendChild( document.createElement('td') )
    connectionElem.classList.add('connection')
    connectionElem.appendChild( document.createElement('img') ).src= ''
    connectionElem.appendChild( document.createElement('img') ).src= '/arrow.svg'
    connectionElem.appendChild( document.createElement('img') ).src= '/online.svg'

    this.tableRow.appendChild( document.createElement('td') )
    this.tableRow.appendChild( document.createElement('td') )
    this.tableRow.appendChild( document.createElement('td') )
    this.tableRow.appendChild( document.createElement('td') )

    this.updateFromPacket( config )
  }

  updateFromPacket( config ) {
    const {action, external, typ, type, from, to, time}= config

    this.activeElem.classList.toggle('active', action === 'start')
    this.activeElem.classList.toggle('inactive', action === 'end')
    this.activeElem.title= action === 'start' ? lang['active'] : lang['inactive']

    this.connectionElem.title= external ? lang['network call'] : lang['rf call']
    this.connectionElem.firstElementChild.src= external ? '/address.svg' : '/radio.svg'

    this.modeElem.innerText= type || typ
    this.callerElem.innerText= `${from} → ${to}`

    if( action === 'start' ) {
      if( this.startTime < 0 ) {
        this.startTime= Date.now()
        this.clockElem.innerText= '0min 0s'
        this.timestampElem.innerText= formatTime( new Date(time) )
      }

      this.clearFadeoutTimer()

    } else if( action === 'end' ) {
      this.startTime= -1
      this.clockElem.innerText= '—'

      this.setFadeoutTimer()

      // If we do not know the start time, just use the end time
      if( !this.timestampElem.innerText ) {
        this.timestampElem.innerText= formatTime( new Date(time) )
      }
    }
  }

  setFadeoutTimer() {
    const keepEntries= document.getElementById('keep-entries-checkbox').checked
    if( !this.fadeOutTimer && !keepEntries ) {
      this.fadeOutTimer= window.setTimeout( () => this.detach(), 10* 60* 1000)
    }
  }

  clearFadeoutTimer() {
    if( this.fadeOutTimer && (this.startTime < 0) ) {
      window.clearTimeout( this.fadeOutTimer )
      this.fadeOutTimer= null
    }
  }

  updateClock() {
    if( this.startTime < 0 ) {
      return
    }

    const time= Math.round( (Date.now()- this.startTime) / 1000 )
    const secs= Math.floor( time % 60 )
    const mins= Math.floor( time / 60 )
    this.clockElem.innerText= `${mins}min ${secs}s`
  }

  attach( table ) {
    table.tBodies[0].prepend( this.tableRow )
  }

  async detach() {
    const fadeOut= [
      {filter: 'opacity(1)'},
      {filter: 'opacity(0.4)'}
    ]
    await this.tableRow.animate(fadeOut, {duration: 500, iterations: 1}).finished
    this.tableRow.parentElement.removeChild( this.tableRow )
  }

  static Break= {}

  static forEach( table, fn ) {
    const rows= table.tBodies[0].rows
    for( let i= 0; i!== rows.length; i++ ) {
      const talker= rows[i]._talkerInstance
      if( talker instanceof Talker ) {
        if( fn( talker ) === Talker.Break ) {
          return
        }
      }
    }
  }

  static findByCallerId( table, id ) {
    let talker= null
    Talker.forEach( table, t => {
      if( t.callerId === id ) {
        talker= t
        return Talker.Break
      }
    })

    return talker
  }

  get activeElem() { return this.tableRow.cells[0] }
  get connectionElem() { return this.tableRow.cells[1] }
  get modeElem() { return this.tableRow.cells[2] }
  get callerElem() { return this.tableRow.cells[3] }
  get clockElem() { return this.tableRow.cells[4] }
  get timestampElem() { return this.tableRow.cells[5] }
}

// Get the main table and setup the clock update timer (update every 500ms)
const table= document.querySelector('main table')
setInterval(() => Talker.forEach(table, talker => talker.updateClock()), 500)

function consumePacket( packet ) {
  // Try to find a row with the same caller id
  const existingTalker= Talker.findByCallerId( table, packet.from )
  if( existingTalker ) {
    existingTalker.updateFromPacket( packet )
    return
  }

  // Create a new table row
  const newTalker= new Talker( packet )
  newTalker.attach( table )
}

// Try to load the history from the server and display it
try {
  const historyResp= await fetch('/history')
  if( !historyResp.ok ) {
    throw Error(`Server status was: ${historyResp.status}`)
  }

  const history= await historyResp.json()
  if( !Array.isArray(history) ) {
    throw Error('Not an array')
  }

  history.forEach( consumePacket )

} catch( e ) {
  console.error('Could not load history:', e)
}

// Connect to the server-sent-event source
const stream= new EventSource('/stream')
stream.addEventListener('message', event => {
  consumePacket( JSON.parse( event.data ) )
})

stream.addEventListener('error', event => {
  console.error('SSE error:', event)
  showErrorModal('Lost connection to the server. Try reloading the page')
})
