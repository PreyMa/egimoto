# MQTT logger

This is a simple JS logging framework that allows defining different
receivers of the logged messages, called sinks. There are sinks for
printing to the console, a log file or to a mqtt broker.

An application can define a global logging configuration and then create
multiple individually named loggers. Each logger uses its name and the
global configuration to deliver the log messages.

## Simple example

```JS
import {Logger} from 'mqtt-logger'

const logger= new Logger({name: 'my-logger', color: Logger.Colors.green})

logger.log('Hello world')
```

## More complex example
```JS
import logging from 'mqtt-logger'

logging.LoggerConfig.init(
  new logging.ConsoleSink(),
  new logging.MqttSink({ /*...*/ }),
  new logging.FileSink()
)

const logger= new logging.Logger({name: 'my-logger'})
```

## Log message types

There are multiple kinds of log message: `info`, `log`, `warn`, `error` and `stats`.
`info` and `log` can be used synonyms and can therefore be used interchangeably.
`log`, `warn` and `error` allow for messages with increasing severity.

```JS
logger.info('Hello world') // Same as .log(...)
logger.warn('Hello warning')
logger.error('Hello error')
```

Like `console.log()` parameters are concatenated.

```JS
logger.log('This is my number', 1, 'best message')
// -> "This is my number 1 best message"
```

`stats` has the same severity level as `info`, however it is treated specially. It is
intended for printing or sending regular system status updates. The message and its
parameters are treated differently by the system, as it is intended for machine
consumption eg. a system health monitor or a dashboard application. The text of
the message is only shown in a formatted way by the `ConsoleSink`, while the other
sinks ignore it. The same goes for non-object parameters. Objects are used to name
the parameters, which are the only things considered by the `FileSink` and `MqttSink`.

```JS
logger.stats(
  'The system is up for', {uptime: 100},
  'hours and served' {requestCount: 1000}, 'requests'
)
// Console -> "The system is up for 100 hours and served 1000 requests"
// Mqtt -> {"time": "...", "type": "stats", "uptime": 100, "requestCount": 1000}
```

Keep in mind that the following names for parameters are disallowed, as they are
reserved for internal use in mqtt packets: `toJSONString`, `logger`, `time` and
`type`

## Message Sinks

### Console
This sink internally calls `console.log()`, `.warn()` and `.error()` to print
messages to the console. Stats messages are printed as formatted text like any
other log message.

Messages are printed with a formatted prefix:

```
[22:21:24 17-Jun-2023] [my-logger] [info] Hello world
```

The following options are supported with the following default values:
```JS
const options= {
  showStats: true
}
```

### File
This sink opens a file in a specified log directory and writes all log messages
to it. The same file is used again after a restart if it is not yet too old or too
large. If it was a new file is created. Old files can be automatically compressed
using gzip.

Individual log messages are printed with a prefix similar to the console sink.
The text of stats messages is ignored, and only a JSON stringified object of all
named parameters is written to the file.

The following options are supported with the following default values:
```JS
const options= {
  fileName: 'logfile',
  directory: '.',
  fileExtension: 'log',
  maxFileSize: 10* 1024* 1024,  // 10MiB in bytes
  maxFileAge: 30,               // 30 days
  compressOldFiles: true
}
```

### Mqtt
This sink creates a mqtt connection to a specified broker to send the log messages
to. The format of the mqtt packets is described in a different section below.

The connection details and credentials are provided as an options object. These have
no default values if not specified otherwise.
```JS
const options= {
  broker: 'mqtt://localhost',
  client: 'test-client',
  username: 'test-user',
  password: 'secret-password',
  path: '/my/topic',
  port: 1883 // can be omitted
}
```

## Mqtt Packets

There are multiple types of packets sent as JSON to the mqtt broker, that share
common `type` and `time` fields. The other fields however depend on the packet's type.

### Hello Packet
This packet is sent on startup to indicate a newly created connection by the 
logger.

```JSON
{
  "type": "hello",
  "time": "2023-06-19T20:25:07.946Z"
}
```

### Log Packet
This packet is send for each logged message. Each packet has the name of the
logger and the message's severity. The actual message is formatted text similar to 
the console sink.

```JSON
{
  "type": "log",
  "time": "2023-06-19T20:25:07.946Z",
  "logger": "my-logger",
  "severity": "info",
  "message": "Formatted message string"
}
```

### Stats Packet
This packet is send for each stats message. Only the named parameters are taken and
added to the packet body.

```JSON
{
  "type": "log",
  "time": "2023-06-19T20:25:07.946Z",
  "logger": "my-logger",
  "custom-value": 1234 /*, ... */
}
```
