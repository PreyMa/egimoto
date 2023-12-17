
function ifMatch( match, fn ) {
  return match ? fn( match.groups, match ) : null
}

export default [
  function dmrStart( line ) {
    return ifMatch( line.match(/M: [\d\-:\. ]{24}DMR Slot (?<slot>\d), received (?<external>RF|network) voice header from (?<from>\d+) to( (?<tg>TG))? (?<to>\d+)/),
      ({slot, external, from, tg, to}) => ({
        type: `DMR TS ${slot}`,
        action: 'start',
        from,
        to: tg ? `TG ${to}` : `PC ${to}`,
        external: external !== 'RF'
      })
    )
  },
  function dmrEnd( line ) {
    return ifMatch( line.match(/M: [\d\-:\. ]{24}DMR Slot (?<slot>\d), received (?<external>RF|network) end of voice transmission from (?<from>\d+) to( (?<tg>TG))? (?<to>\d+)/),
      ({slot, external, from, tg, to}) => ({
        type: `DMR TS ${slot}`,
        action: 'end',
        from,
        to: tg ? `TG ${to}` : `PC ${to}`,
        external: external !== 'RF'
      })
    )
  },
  function ysfStart( line ) {
    return ifMatch( line.match(/M: [\d\-:\. ]{24}YSF, received (?<external>RF header|network data) from (?<from>\w+)\s+to (?<to>(DG-ID )?\d+)/),
      ({external, from, to}) => ({
        type: 'YSF',
        action: 'start',
        from, to,
        external: !external.startsWith('RF')
      })
    )
  },
  function ysfEnd( line ) {
    return ifMatch( line.match(/M: [\d\-:\. ]{24}YSF, received (?<external>RF|network) end of transmission from (?<from>\w+)\s+to (?<to>(DG-ID )?\d+)/),
    ({external, from, to}) => ({
        type: 'YSF',
        action: 'end',
        from, to,
        external: !external.startsWith('RF')
      })
    )
  },
  function dStarStart( line ) {
    return ifMatch( line.match(/M: [\d\-:\. ]{24}D-Star, received (?<external>RF|network) header from (?<from>\w+)\s+(\/.*)? to (?<to>\w+)/),
    ({external, from, to}) => ({
        type: 'D-Star',
        action: 'start',
        from, to,
        external: external !== 'RF'
      })
    )
  },
  function dStarStart( line ) {
    return ifMatch( line.match(/M: [\d\-:\. ]{24}D-Star, received (?<external>RF|network) end of transmission from (?<from>\w+)\s+(\/.*)? to (?<to>\w+)/),
    ({external, from, to}) => ({
        type: 'D-Star',
        action: 'end',
        from, to,
        external: external !== 'RF'
      })
    )
  }
]
