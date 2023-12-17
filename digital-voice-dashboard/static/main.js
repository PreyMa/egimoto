import langs from './lang.js'

if( window.location.pathname === '/' ) {
  const chronologicalCheckbox= document.getElementById('chronological-checkbox')
  const keepEntriesCheckbox= document.getElementById('keep-entries-checkbox')

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

  document.querySelectorAll('input[data-stored').forEach( input => {
    const storedValue= localStorage.getItem(input.name)
    if( input.type === 'radio' ) {
      if( storedValue !== null ) {
        input.checked= storedValue === input.value
      }
      input.addEventListener('change', e => localStorage.setItem(input.name, input.value))
    } else {
      if( storedValue !== null ) {
        input.checked= storedValue !== 'false'
      }
      input.addEventListener('change', e => localStorage.setItem(input.name, input.checked))
    }
  })

  let lang= null

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
  keepEntriesCheckbox.addEventListener('change', e => {
    if( keepEntriesCheckbox.checked ) {
      Talker.forEach(table, talker => talker.clearFadeoutTimer())
    } else {
      Talker.forEach(table, talker => talker.setFadeoutTimer())
    }
  })

  // Try to load the history from the server. Return an empty history on error
  async function loadHistory() {
    try {
      const historyResp= await fetch('/history')
      if( !historyResp.ok ) {
        throw Error(`Server status was: ${historyResp.status}`)
      }

      const history= await historyResp.json()
      if( !Array.isArray(history) ) {
        throw Error('Not an array')
      }

      return history

    } catch( e ) {
      console.error('Could not load history:', e)
      return []
    }
  }

  class HistoryStream {
    constructor( url, history= [] ) {
      this._stream= new EventSource( url )
      this._history= history
      this.onPacket= null

      this._stream.addEventListener('message', event => this._handlePacket(event))
      this._stream.addEventListener('error', event => this._handleError(event))
    }

    _handlePacket( event ) {
      try {
        const packet= JSON.parse( event.data )
        this._history.push( packet )
        while( this._history.length > 10000 ) {
          this._history.shift()
        }

        if( this.onPacket ) {
          this.onPacket( packet )
        }
        
      } catch( e ) {
        console.error('Could not handle incoming packet:', e)
      }
    }

    _handleError( event ) {
      console.error('SSE error:', event)
      showErrorModal('Lost connection to the server. Try reloading the page')
    }

    forEach( func ) {
      this._history.forEach( func )
    }
  }

  class Talker {
    constructor( config ) {
      this.startTime= -1
      this.fadeOutTimer= null
      this.callerId= config.from
      this.mode= config.type || config.typ
      this.callerIdsLabel= ''
      this.callerNamesLabel= ''
      this.showsCallerNames= true

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

      const callerElem= this.tableRow.appendChild( document.createElement('td') )
      callerElem.classList.add('caller')
      callerElem.appendChild( document.createElement('img') ).addEventListener('click', () => this.displayCallerFieldNames( !this.showsCallerNames ) )
      callerElem.appendChild( document.createElement('span') )
      
      const clockElem= this.tableRow.appendChild( document.createElement('td') )
      clockElem.innerText= '-'

      this.tableRow.appendChild( document.createElement('td') )

      this.updateFromPacket( config )
    }

    updateFromPacket( config ) {
      const {action, external, typ, type, from, fromName, to, toName, time: isoTime}= config

      this.callerId= from
      this.mode= type || typ

      this.activeElem.classList.toggle('active', action === 'start')
      this.activeElem.classList.toggle('inactive', action === 'end')
      this.activeElem.title= action === 'start' ? lang['active'] : lang['inactive']

      this.connectionElem.title= external ? lang['network call'] : lang['rf call']
      this.connectionElem.firstElementChild.src= external ? '/address.svg' : '/radio.svg'

      this.modeElem.innerText= type || typ
      this.callerNamesLabel= `${fromName || from} → ${toName || to}`
      this.callerIdsLabel= `${from} → ${to}`
      this.displayCallerFieldNames( this.showsCallerNames )

      const time= new Date( isoTime )

      if( action === 'start' ) {
        if( this.startTime < 0 ) {
          this.startTime= time.getTime()
          this.clockElem.innerText= '0min 0s'
          this.timestampElem.innerText= formatTime( time )
          this.timestampElem.title= time.toISOString()
        }

        this.clearFadeoutTimer()

      } else if( action === 'end' ) {
        // Keep the clock value in chronological view
        if( chronologicalCheckbox.checked ) {
          this._updateClockToReference( time.getTime() )
        } else {
          this.clockElem.innerText= '—'
        }

        this.startTime= -1
        this.setFadeoutTimer()

        // If we do not know the start time, just use the end time
        if( !this.timestampElem.innerText ) {
          this.timestampElem.innerText= formatTime( time )
          this.timestampElem.title= time.toISOString()
        }
      }
    }

    setFadeoutTimer() {
      if( !this.fadeOutTimer && !keepEntriesCheckbox.checked ) {
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
      this._updateClockToReference( Date.now() )
    }

    _updateClockToReference( endTime ) {
      if( this.startTime < 0 ) {
        return
      }

      const time= Math.round( (endTime- this.startTime) / 1000 )
      const secs= Math.floor( time % 60 )
      const mins= Math.floor( time / 60 )
      this.clockElem.innerText= `${mins}min ${secs}s`
    }

    displayCallerFieldNames( showCallerNames ) {
      const [icon, span]= this.callerElem.children
      if( this.showsCallerNames= showCallerNames ) {
        icon.src= '/tag.svg'
        icon.title= lang['show ids']
        span.innerText= this.callerNamesLabel
        span.title= this.callerIdsLabel

      } else {
        icon.src= '/hashtag.svg'
        icon.title= lang['show names']
        span.innerText= this.callerIdsLabel
        span.title= this.callerNamesLabel
      }
    }

    attach( table ) {
      table.prepend( this.tableRow )
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
      const rows= table.rows
      for( let i= 0; i!== rows.length; i++ ) {
        const talker= rows[i]._talkerInstance
        if( talker instanceof Talker ) {
          if( fn( talker ) === Talker.Break ) {
            return
          }
        }
      }
    }

    static findFirst( table, fn ) {
      let talker= null
      Talker.forEach( table, t => {
        if( fn( t ) ) {
          talker= t
          return Talker.Break
        }
      })

      return talker
    }

    static findByCallerId( table, id ) {
      return this.findFirst( table, t => t.callerId === id )
    }

    static findByCallerIdAndMode( table, id, mode ) {
      return this.findFirst( table, t => t.callerId === id && t.mode === mode )
    }

    get activeElem() { return this.tableRow.cells[0] }
    get connectionElem() { return this.tableRow.cells[1] }
    get modeElem() { return this.tableRow.cells[2] }
    get callerElem() { return this.tableRow.cells[3] }
    get clockElem() { return this.tableRow.cells[4] }
    get timestampElem() { return this.tableRow.cells[5] }
  }

  // Get the main table and setup the clock update timer (update every 500ms)
  const table= document.querySelector('main table').tBodies[0]
  setInterval(() => Talker.forEach(table, talker => talker.updateClock()), 500)

  function clearTable() {
    // Delete all rows except the very last one (this is the table empty message)
    while( table.rows.length > 1 ) {
      table.deleteRow( 0 )
    }
  }

  function consumePacket( packet ) {
    // Group everything in grouped mode by user id
    if( !chronologicalCheckbox.checked ) {
      // Try to find a row with the same caller id
      const existingTalker= Talker.findByCallerId( table, packet.from )
      if( existingTalker ) {
        existingTalker.updateFromPacket( packet )
        return
      }
    // Only group end packets with start packets in chronological view by user id and mode
    } else if( packet.action === 'end' ) {
      const existingTalker= Talker.findByCallerIdAndMode( table, packet.from, packet.type || packet.typ )
      if( existingTalker ) {
        existingTalker.updateFromPacket( packet )
        return
      }
    }

    // Create a new table row
    const newTalker= new Talker( packet )
    newTalker.attach( table )
  }

  // Connect to the server-sent-event source
  const history= await loadHistory()
  const stream= new HistoryStream('/stream', history)

  stream.forEach( consumePacket )
  stream.onPacket= consumePacket

  // Setup chronological/grouped view toggle button
  chronologicalCheckbox.addEventListener('change', e => {
    clearTable()
    stream.forEach( consumePacket )
  })
}
