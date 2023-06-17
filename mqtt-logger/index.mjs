import path from 'node:path'
import fs from 'node:fs'
import zlib from 'node:zlib'
import util from 'node:util'
import mqtt from 'mqtt'
import colors from 'colors/safe.js'

function abstractMethod() {
  throw Error('Abstract method')
}

export class MessageArguments {
  constructor(args= []) {
    this._args= args
    this._messageString= null
    this._formattedTime= null
  }

  get args() {
    return this._args
  }

  messageString() {
    if( this._messageString !== null ) {
      return this._messageString
    }

    this._messageString= this._args.map(x => typeof x === 'string' ? x : util.inspect(x)).join(' ')
    return this._messageString
  }

  timeString( sink ) {
    if( this._formattedTime !== null ) {
      return this._formattedTime.formatted
    }

    this._formattedTime= sink._printTime()
    return this._formattedTime.formatted
  }
}

export class Sink {
  attach() { abstractMethod() }
  close() { abstractMethod() }
  logMessage() { abstractMethod() }
  logStats() { abstractMethod() }

  static _monthNames= ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Nov', 'Dec']

  _printTime(onlyDashes= false) {
    const padded= num => num.toString().padStart(2, '0')
    const time= new Date()
    const day= padded(time.getUTCDate())
    const month= Sink._monthNames[ time.getUTCMonth() ]
    const year= time.getUTCFullYear()
    const hour= padded(time.getUTCHours())
    const min= padded(time.getUTCMinutes())
    const sec= padded(time.getUTCSeconds())

    const formatted= onlyDashes
      ? `${hour}-${min}-${sec}_${day}-${month}-${year}` // only dashes for filenames
      : `${hour}:${min}:${sec} ${day}-${month}-${year}` // nicer to read format for log messages

    return {time, formatted}
  }

  _readTime(obj) {
    const day= parseInt(obj.day)
    const month= Sink._monthNames.findIndex(x => x.toLowerCase() === obj.month.toLowerCase())
    const year= parseInt(obj.year)
    const hour= parseInt(obj.hour)
    const min= parseInt(obj.min)
    const sec= parseInt(obj.sec)

    const invalid= Number.isNaN(day)
      || (month < 0)
      || Number.isNaN(year)
      || Number.isNaN(hour)
      || Number.isNaN(min)
      || Number.isNaN(sec)
    if(invalid) {
      return null
    }

    const time= new Date(0)
    time.setUTCDate(day)
    time.setUTCMonth(month)
    time.setUTCFullYear(year)
    time.setUTCHours(hour)
    time.setUTCMinutes(min)
    time.setUTCSeconds(sec)
    return time
  }

  _extractStatsObjectFromArgs(args) {
    const statsObject= {}
    args.forEach(arg => {
      if( typeof arg === 'object' ) {
        const firstKey= Object.keys(arg)[0]
        if( typeof firstKey === 'string' && firstKey.length ) {
          statsObject[firstKey]= arg[firstKey]
        }
      }
    })

    return statsObject
  }

  _paddedAndColoredName(logger, colored) {
    const length= LoggerConfig.the()._longestLoggerNameLength
    const paddedName= logger._name.padEnd(length)
    return colored ? logger._color(paddedName) : paddedName
  }

  _messagePrefix(logger, severity, args= null, colored= true) {
    const timeString= args ? args.timeString(this) : this._printTime().formatted
    const name= this._paddedAndColoredName(logger, colored)

    return `[${timeString}] [${name}] [${severity}]`
  }
}

export class ConsoleSink extends Sink {
  constructor(config= {}) {
    super()
    config= Object.assign({
      showStats: true
    }, config)

    this._showStats= config.showStats
  }

  attach() {}
  close() {}

  _printMessage(logger, severity, argArray, args= null) {
    const loggingFunctions= {
      'info': console.log,
      'warn': console.warn,
      'error': console.error
    }

    const prefix= this._messagePrefix(logger, severity, args)
    const loggingFunction= loggingFunctions[severity] || loggingFunctions.info
    loggingFunction(prefix, ...argArray)
  }

  logMessage(logger, severity, args) {
    this._printMessage(logger, severity, args.args, args)
  }

  logStats(logger, args) {
    if(!this._showStats) {
      return
    }

    // Unpack objects as their name is not relevant here
    const unpackedArgs= args.map(arg => typeof arg === 'object' ? Object.values(arg)[0] : arg)
    this._printMessage(logger, 'stats', unpackedArgs)
  }
}

export class MqttMessage {
  constructor(type) {
    this.time= new Date().toISOString()
    this.type= type
  }

  toJSONString() {
    return JSON.stringify(this)
  }
}

export class MqttHelloMessage extends MqttMessage {
  constructor() { super('hello') }
}

export class MqttLogMessage extends MqttMessage {
  constructor( loggerName, severity, messageString ) {
    super('log')
    this.logger= loggerName
    this.severity= severity
    this.message= messageString
  }
}

export class MqttStatsMessage extends MqttMessage {
  constructor( loggerName, statsObject ) {
    super('stats')
    if(statsObject.hasOwnProperty('toJSONString') || statsObject.hasOwnProperty('logger')) {
      throw Error(`Cannot set keys 'toJSONString' & 'logger' in stats object`)
    }
    Object.assign(this, statsObject)
    this.logger= loggerName
  }
}

export class MqttSink extends Sink {
  constructor(config) {
    super()
    const valid= config.broker
      && config.client
      && config.username
      && config.password
      && config.path
    if(!valid) {
      throw Error('Invalid mqtt configuration')
    }

    this._broker= config.broker
    this._path= config.path
    this._credentials= {
      client: config.client,
      username: config.username,
      password: config.password,
      port: config.port
    }
    this._client= null
  }

  attach() {
    this._client= mqtt.connect(this._broker, this._credentials)

    const internalLogger= LoggerConfig.the().internalInstance
    this._client.on('connect', () => internalLogger.log('MQTT client connected'))
    this._client.on('error', err => {
      internalLogger.error('MQTT error received', err);
    })

    this._publish(new MqttHelloMessage())
  }
  
  close() {
    if(this._client) {
      this._client.end()
      this._client= null
    }
  }

  _publish( msg ) {
    if( this._client ) {
      this._client.publish(this._path, msg.toJSONString());
    }
  }

  logMessage(logger, severity, args) {
    const messageString= args.messageString()
    this._publish(new MqttLogMessage(logger._name, severity, messageString))
  }

  logStats(logger, args) {
    const statsObject= this._extractStatsObjectFromArgs(args)
    this._publish(new MqttStatsMessage(logger._name, statsObject))
  }
}

export class FileSink extends Sink {
  constructor(config) {
    super()
    config= Object.assign({
      fileName: 'logfile',
      directory: '.',
      fileExtension: 'log',
      maxFileSize: 10* 1024* 1024,  // 10MiB
      maxFileAge: 30,               // 30 days
      compressOldFiles: true,
    }, config)

    this._fileName= config.fileName
    this._directory= config.directory
    this._fileExtension= config.fileExtension
    this._maxFileSize= config.maxFileSize
    this._maxFileAge= config.maxFileAge
    this._compressOldFiles= config.compressOldFiles
    this._logFile= null
  }

  _createFilePath() {
    const {formatted}= this._printTime(true)
    const name= `${this._fileName}_${formatted}.${this._fileExtension}`
    this._path= path.join(this._directory, name)
  }

  _loadFiles() {
    let newestFile= null, newestTime= 0
    const filesToCompress= []
    const thresholdTime= Date.now() - this._maxFileAge* 24* 60* 60* 1000
    const logDirectory= fs.opendirSync(this._directory)
    let dirEntry= null
    try {
      while((dirEntry = logDirectory.readSync()) !== null) {
        // Try to match the file name to the schema
        const nameSplitter= /^(?<name>\w+)_(?<hour>\d\d)-(?<min>\d\d)-(?<sec>\d\d)_(?<day>\d\d)-(?<month>[A-Za-z]{3})-(?<year>\d{4})\.(?<extension>\w+)$/
        const match= dirEntry.name.match(nameSplitter)
        if( match ) {
          // Extract all information from the file name string
          const name= match.groups.name
          const extension= match.groups.extension
          const time= this._readTime(match.groups)
          
          // Only consider files with the right name and file extension
          if(name === this._fileName && extension === this._fileExtension) {
            
            // File that is new and small enough to be used as the current log file
            // and it is newer than the currently newest file
            const fullPath= path.join(this._directory, dirEntry.name)
            if( (time >= thresholdTime) && (newestFile === null || newestTime < time) ) {
              // Only fstat the file if all the other conditions are already met
              const stats= fs.statSync(fullPath)
              if(stats.size < this._maxFileSize) {
                if(newestFile) {
                  filesToCompress.push(newestFile)
                }
  
                newestTime= time
                newestFile= fullPath
                continue
              }
            }

            // Old and large files need to be compressed
            filesToCompress.push(fullPath)
          }
        }
      }
    } finally {
      logDirectory.close()
    }

    return {newestFile, filesToCompress}
  }

  _compressFile(path) {
    const zip = zlib.createGzip()
    const read = fs.createReadStream( path )
    const write = fs.createWriteStream( path+ '.gz')

    const internalLogger= LoggerConfig.the().internalInstance
    read.pipe(zip).pipe(write)
      .on('close', () => fs.unlink(path, err => err ? internalLogger.error('Could not delete file:', p) : 0) )
      .on('error', error => internalLogger.error('Could not compress file:', path))
  }

  attach() {
    const {newestFile, filesToCompress}= this._loadFiles()

    if( newestFile === null ) {
      this._createFilePath()
    } else {
      this._path= newestFile
    }

    this._logFile= fs.openSync(this._path, 'a')
    const internalLogger= LoggerConfig.the().internalInstance
    internalLogger.log(`Current log file is '${this._path}'`)

    if( this._compressOldFiles && filesToCompress.length > 0 ) {
      internalLogger.log(`Compressing ${filesToCompress.length} log files`)
      filesToCompress.forEach(f => this._compressFile(f))
    }
  }

  close() {
    if( this._logFile !== null) {
      fs.closeSync(this._logFile)
      this._logFile= null
    }
  }

  _printMessage(logger, severity, messageString, args= null) {
    if( this._logFile !== null) {
      const prefix= this._messagePrefix(logger, severity, args, false)
      fs.write( this._logFile, prefix+ ' '+ messageString+ '\n', null, 'utf8', err => {
        if( err ) {
           LoggerConfig.the().internalInstance.error('Could not write to log file:', err)
        }
      })
    }
  }

  logMessage(logger, severity, args) {
    const messageString= args.messageString()
    this._printMessage(logger, severity, messageString, args)
  }

  logStats(logger, args) {
    const statsObject= this._extractStatsObjectFromArgs(args)
    this._printMessage(logger, 'stats', JSON.stringify(statsObject))
  }
}

export class LoggerConfig {
  static _instance= null;

  static the() {
    if(!this._instance) {
      this._instance= new LoggerConfig()
    }
    return this._instance
  }

  static init(...args) {
    this._instance= new LoggerConfig(...args)
  }

  static close() {
    if(this._instance) {
      this._instance.close()
    }
  }

  constructor(...sinks) {
    if(LoggerConfig._instance) {
      throw Error('Cannot define multiple logger configs')
    }

    LoggerConfig._instance= this

    this._sinks= sinks
    this._activeLoggers= []
    this._uniqueIdCounter= 0
    this._longestLoggerNameLength= 0
    this._consoleSink= null

    // Create and add the internal logger instance
    const internalLoggerInstance= new InternalLogger()

    // Add default sink if no sinks were provided
    if(!this._sinks.length) {
      this._sinks.push(new ConsoleSink())
    }

    // Find or create console sink for error logging
    const foundConsoleSink= this._sinks.some(s => s instanceof ConsoleSink ? this._consoleSink= s : false)
    if(!foundConsoleSink) {
      this._consoleSink= new ConsoleSink()
      this._consoleSink.attach()
    }

    this._sinks.forEach(sink => sink.attach())
  }

  registerLogger(logger) {
    this._activeLoggers.push(logger)
    this._longestLoggerNameLength= Math.max(this._longestLoggerNameLength, logger._name.length)
    return this._uniqueIdCounter++
  }

  close() {
    this._consoleSink.close()
    this._sinks.forEach(s => s.close())
    this._sinks.length= 0
  }

  get internalInstance() {
    return this._activeLoggers[0]
  }

  logMessage(logger, severity, argArray) {
    const args= new MessageArguments( argArray )
    this._sinks.forEach(sink => sink.logMessage(logger, severity, args))
  }

  logStats(logger, argArray) {
    this._sinks.forEach(sink => sink.logStats(logger, argArray))
  }

  logConsoleMessage(logger, severity, argArray) {
    const args= new MessageArguments( argArray )
    this._consoleSink.logMessage(logger, severity, args)
  }
}

export class Logger {
  static Colors= colors

  constructor(config= {}) {
    config= Object.assign({
      color: colors.white,
      name: ''
    }, config)

    this._color= config.color
    this._name= config.name || `logger-${this.id}`
    this._id= LoggerConfig.the().registerLogger(this)
  }

  log(...args) { this.info(...args) }
  info(...args) { LoggerConfig.the().logMessage(this, 'info', args) }
  warn(...args) { LoggerConfig.the().logMessage(this, 'warn', args) }
  error(...args) { LoggerConfig.the().logMessage(this, 'error', args) }
  stats(...args) { LoggerConfig.the().logStats(this, args) }
}

class InternalLogger extends Logger {
  constructor() {
    super({color: colors.white, name: 'Logger'})
  }

  info(...args) { LoggerConfig.the().logMessage(this, 'info', args) }
  warn(...args) { LoggerConfig.the().logMessage(this, 'warn', args) }
  error(...args) { LoggerConfig.the().logConsoleMessage(this, 'error', args) }
}


export default {
  MessageArguments,
  Sink,
  MqttSink,
  ConsoleSink,
  FileSink,
  MqttMessage,
  MqttHelloMessage,
  MqttLogMessage,
  MqttStatsMessage,
  LoggerConfig,
  Logger
}
