
class Matcher {
  constructor( line ) {
    this.line= line
    this.packet= null
  }

  match( regex, handler ) {
    if( !this.packet ) {
      const match= this.line.match( regex )
      if( match ) {
        this.packet= handler( match.groups, match ) || null
      }
    }
    return this
  }

  result() {
    return this.packet
  }
}

class Provider {
  tryConsumeLine( line ) {}
}

class DmrProvider extends Provider {
  tryConsumeLine( line ) {
    return new Matcher( line )
      .match(/M: [\d\-:\. ]{24}DMR Slot (?<slot>\d), received (?<external>RF|network) voice header from (?<from>\d+) to( (?<tg>TG))? (?<to>\d+)/, groups => this._packet( groups, 'start') )
      .match(/M: [\d\-:\. ]{24}DMR Slot (?<slot>\d), received (?<external>RF|network) end of voice transmission from (?<from>\d+) to( (?<tg>TG))? (?<to>\d+)/, groups => this._packet( groups, 'end') )
      .result()
  }

  _packet({slot, external, from, tg, to}, action) {
    return {
      type: `DMR TS ${slot}`,
      action, from,
      to: tg ? `TG ${to}` : `PC ${to}`,
      external: external !== 'RF'
    }
  }
}

class YsfProvider extends Provider {
  constructor() {
    super()
    this.lastStartPacket= null
  }

  tryConsumeLine( line ) {
    return new Matcher( line )
      .match(/M: [\d\-:\. ]{24}YSF, received (?<external>RF header|network data) from (?<from>\w+)\s+to (?<to>(DG-ID )?\d+)/, groups => this._packet( groups, 'start') )
      .match(/M: [\d\-:\. ]{24}YSF, received (?<external>RF|network) end of transmission from (?<from>\w+)\s+to (?<to>(DG-ID )?\d+)/, groups => this._packet( groups, 'end') )
      .match(/M: [\d\-:\. ]{24}YSF, network watchdog has expired/, () => this._timeoutPacket() )
      .result()
  }

  _packet({external, from, to}, action) {
    const packet= {
      type: 'YSF',
      action, from, to,
      external: !external.startsWith('RF')
    }

    this.lastStartPacket= action === 'start' ? packet : null
    return packet
  }

  _timeoutPacket() {
    const packet= this.lastStartPacket
    this.lastStartPacket= null
    if( packet ) {
      packet.action= 'end'
    }
    return packet
  }
}

class DStarProvider extends Provider {
  tryConsumeLine( line ) {
    return new Matcher( line )
      .match(/M: [\d\-:\. ]{24}D-Star, received (?<external>RF|network) header from (?<from>\w+)\s+(\/.*)? to (?<to>\w+)/, groups => this._packet( groups, 'start') )
      .match(/M: [\d\-:\. ]{24}D-Star, received (?<external>RF|network) end of transmission from (?<from>\w+)\s+(\/.*)? to (?<to>\w+)/, groups => this._packet( groups, 'end') )
      .result()
  }

  _packet({external, from, to}, action) {
    return {
      type: 'D-Star',
      action, from, to,
      external: external !== 'RF'
    }
  }
}

class M17Provider extends Provider {
  tryConsumeLine( line ) {
    return new Matcher( line )
      .match(/M: [\d\-:\. ]{24}M17, received (?<external>RF (late entry )?voice transmission|network voice transmission) from (?<from>\w+|(\w+\s+\w))\s+to (?<to>\w+)/, groups => this._packet( groups, 'start') )
      .match(/M: [\d\-:\. ]{24}M17, received (?<external>RF|network) end of transmission from (?<from>\w+|(\w+\s+\w))\s+to (?<to>\w+)/, groups => this._packet( groups, 'end') )
      .result()
  }

  _packet({external, from, to}, action) {
    return {
      type: 'M17',
      action, from, to,
      external: external !== 'RF'
    }
  }
}


export default [ new DmrProvider(), new YsfProvider(), new DStarProvider(), new M17Provider() ]
