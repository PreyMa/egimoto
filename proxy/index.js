import fs from 'node:fs'
import tls from 'node:tls'
import url from 'node:url'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import logging from 'mqtt-logger'
import httpProxy from 'http-proxy'

let notFoundPageTemplate= 'Unknown host domain name: {{requestDomain}}';
const logger= new logging.Logger({name: 'proxy', color: logging.Logger.Colors.green})

function abstractMethod() {
  throw Error('Abstract method');
}

function rdFile( p ) {
  return fs.readFileSync(path.resolve( p )).toString();
}

function stop( msg ) {
  console.error( msg );
  process.exit( 1 );
}

function checkKeys( o, keys, fn ) {
  keys.forEach( k => o.hasOwnProperty( k ) ? 0 : fn( k ) );
}

function isoTime() {
  return new Date().toISOString();
}

function genericMax(a, b) {
  return a > b ? a : b;
}

class HostEntry {
  static create(name, obj, certificates) {
    const hasRedirectField= obj.hasOwnProperty('redirect');
    const hasProxyField= obj.hasOwnProperty('proxy');
    const hasInsecureField= obj.hasOwnProperty('insecure');
    const hasCertField= obj.hasOwnProperty('cert');

    if( !hasRedirectField && !hasProxyField ) {
      stop(`Host '${name}' has neither a 'redirect', 'proxy' nor 'insecure' field`);
    }

    if( hasProxyField ) {
      if( !obj.proxy.startsWith('http://') ) {
        logger.warn(`Warning: Missing 'http://' prefix on proxy file for host: ${name}`);
      }
    }

    if( hasInsecureField ) {
      if( obj.insecure !== true ) {
        stop(`Host '${name}' has invalid 'insecure' field. Only 'true' is supported.`);
      }

      if( hasCertField ) {
        logger.warn(`Host '${name}' has ignored field 'cert'`);
      }

      if( hasProxyField ) {
        return new InsecureProxyHost(null, obj.proxy);
      }
      
      return new InsecureRedirectHost(null, obj.redirect);
    }

    if(!hasCertField) {
      stop(`Missing config parameter 'cert' for host: ${name}`);
    }

    if( !certificates.has(obj.cert) ) {
      stop(`Unknown certificate '${obj.cert}' for host: ${name}`);
    }

    const cert= certificates.get(obj.cert);
    if( hasProxyField ) {
      return new SecureProxyHost(cert, obj.proxy);
    }
    
    return new SecureRedirectHost(cert, obj.redirect);
  }

  constructor(cert, target) {
    this.cert= cert;
    this.target= target;
  }

  insecurePrefix( isInsecure ) { return isInsecure ? 'insecure ' : ''; }

  handleInsecureWebRequest() { abstractMethod(); }
  handleInsecureUpgradeRequest() { abstractMethod(); }
  handleSecureWebRequest() { abstractMethod(); }
  handleSecureUpgradeRequest() { abstractMethod(); }
  handleSNICallback() { abstractMethod(); }

  sendInvalidDomainUpgradeError(req, socket, insecure) {
    const domain= req.headers['host'];
    const prefix= this.insecurePrefix( insecure );
    logger.error(`${prefix}upgrade: Invalid domain: ${domain}`);
    socket.end(`Proxy-Error: Upgrade to invalid domain: ${domain}`);
  }

  redirectRequest(req, res, domain, insecureProtocol= false) {
    const protocol= insecureProtocol ? 'http://' : 'https://';
    res.writeHead(301, { Location: protocol + domain + req.url });
    res.end('Redirecting...');
  }

  promoteRedirectToSecure(req, res) {
    logger.log('insecure receive: promote redirect to secure:', req.headers['host']);
    this.redirectRequest(req, res, req.headers['host']);
  }

  proxyWebRequest(proxy, req, res, insecure) {
    try {
      proxy.web( req, res, { target: this.target } );
    } catch(e) {
      const prefix= this.securePrefix(insecure);
      logger.error(`Could not proxy ${prefix}request to: ${this.target}`);
      logger.error(e);

      if( !res.writableEnded ) {
          res.end('Proxy-Error: Server currently not available');
      }
    }
  }

  proxyUpgradeRequest(proxy, req, socket, head, insecure) {
    try {
      proxy.ws(req, socket, head, { target: this.target });
    } catch(e) {
      const prefix= this.insecurePrefix(insecure);
      logger.error(`Could not proxy ${prefix}websocket to: ${this.target}`);
      logger.error(e);

      if( !socket.writableEnded ) {
          socket.end('Proxy-Error: Server currently not available');
      }
    }
  }
}

/**
 * Unknown entry for default/unknown hosts
 */
class UnknownEntry extends HostEntry {
  sendError404(req, res) {
    const domain= req.headers['host'];
    logger.log(`insecure receive: unknown domain: ${domain}`);

    const message= notFoundPageTemplate.replaceAll('{{requestDomain}}', domain);
    res.writeHead(404);
    res.end(message);
  }

  handleInsecureWebRequest(proxy, req, res) {
    this.sendError404(req, res);
  }

  handleInsecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, true);
  }

  handleSecureWebRequest(proxy, req, res) {
    this.sendError404(req, res);
  }

  handleSecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, false);
  }

  handleSNICallback( cb, domain ) {
    cb( new Error("Domain not found"), null );
    logger.log( 'SNI-Error: domain not found:', domain );
  }
}

HostEntry.Unknown= new UnknownEntry(null, null);

/**
 * Represents secure redirect entries in the config file
 * `{ cert: 'certName', redirect: 'www.another.subdomain.com' }`
 */
class SecureRedirectHost extends HostEntry {
  handleInsecureWebRequest(proxy, req, res) {
    this.promoteRedirectToSecure(req, res);
  }

  handleInsecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, true);
  }

  handleSecureWebRequest(proxy, req, res) {
    logger.log('receive: redirect to secure:', this.target);
    this.redirectRequest(req, res, this.target, false);
  }

  handleSecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, false);
  }

  handleSNICallback( cb ) {
    cb(null, this.cert);
  }
}

/**
 * Represents secure proxy entries in the config file:
 * `{ cert: 'certName, redirect: 'www.another.subdomain.com' }`
 */
class SecureProxyHost extends HostEntry {
  handleInsecureWebRequest(proxy, req, res) {
    this.promoteRedirectToSecure(req, res);
  }

  handleInsecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, true);
  }

  handleSecureWebRequest(proxy, req, res) {
    logger.log('receive: proxiing request to secure:', this.target, req.url);
    this.proxyWebRequest(proxy, req, res, false);
  }

  handleSecureUpgradeRequest(proxy, req, socket, head) {
    logger.log('upgrade: proxiing websocket to secure:', this.target, req.url);
    this.proxyUpgradeRequest(proxy, req, socket, head, false);
  }

  handleSNICallback( cb ) {
    cb(null, this.cert);
  }
}

/**
 * Represents insecure redirect entries in the config file:
 * `{ insecure: true, redirect: 'www.another.subdomain.com' }`
 */
class InsecureRedirectHost extends HostEntry {
  handleInsecureWebRequest(proxy, req, res) {
    logger.log('insecure receive: redirecting to insecure:', this.target);
    this.redirectRequest(req, res, this.target, true);
  }

  handleInsecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, true);
  }

  handleSecureWebRequest(proxy, req, res) {
    logger.log('receive: demote redirect to insecure (redirect):', this.target);
    this.redirectRequest(req, res, this.target, true);
  }

  handleSecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, false);
  }

  handleSNICallback( cb ) {
    cb(null, null);
  }
}

/**
 * Represents insecure proxy entries in the config file:
 * `{ insecure: true, proxy: 'http://localhost:1000' }`
 */
class InsecureProxyHost extends HostEntry {
  handleInsecureWebRequest(proxy, req, res) {
    logger.log('insecure receive: proxiing request to insecure:', this.target, req.url);
    this.proxyWebRequest(proxy, req, res, true);
  }

  handleInsecureUpgradeRequest(proxy, req, socket, head) {
    logger.log('insecure upgrade: proxiing websocket to insecure:', this.target, req.url);
    this.proxyUpgradeRequest(proxy, req, socket, head, true);
  }

  handleSecureWebRequest(proxy, req, res) {
    const domain= req.headers['host'];
    logger.log('receive: demote redirect to insecure (proxy):', domain);
    this.redirectRequest(req, res, domain, true);
  }

  handleSecureUpgradeRequest(proxy, req, socket, head) {
    this.sendInvalidDomainUpgradeError(req, socket, false);
  }

  handleSNICallback( cb ) {
    cb(null, null);
  }
}

/**
 * Server script entry point
 */
(function() {
  const dirName= url.fileURLToPath(new URL('.', import.meta.url))
  const config= JSON.parse( rdFile('./config.json') );

  // Create mqtt logger
  if( config.hasOwnProperty('mqtt') ) {
    checkKeys(config.mqtt, ['gateway', 'client', 'username', 'password', 'path'], key => {
      stop(`Missing config value ${key} in mqtt settings`);
    });

    const mqttLoggingOptions= {
      broker: config.mqtt.gateway,
      client: config.mqtt.client,
      username: config.mqtt.username,
      password: config.mqtt.password,
      path: config.mqtt.path
    }

    logging.LoggerConfig.the().init(
      new logging.ConsoleSink(),
      new logging.MqttSink(mqttLoggingOptions)
    )
  }

  // Load main config data
  checkKeys( config, ['httpPort', 'httpsPort', 'mainCert', 'certificates', 'hosts'], k => {
    stop(`Missing config parameter '${k}'`);
  });

  // Make sure port numbers are integers
  config.httpPort= parseInt(config.httpPort);
  config.httpsPort= parseInt(config.httpsPort);

  if( Number.isNaN(config.httpPort) || Number.isNaN(config.httpsPort) ) {
    stop('Config error: Invalid port numbers');
  }

  // Load 404 page if one is specified
  if( config.hasOwnProperty('notFoundPage') ) {
    const notFoundPagePath= config.notFoundPage === 'default' ? path.join(dirName, 'notFound.html') : config.notFoundPage;
    notFoundPageTemplate= rdFile(notFoundPagePath);
  }

  // Create secure context for each certificate
  let secureOptions= null;
  const certificates= new Map();
  for( const name in config.certificates ) {
    const obj= config.certificates[name];
    checkKeys( obj, ['key', 'cert', 'ca'], k => {
      stop(`Missing config parameter '${k}' for certificate: ${name}`);
    });

    const key= rdFile( obj.key );
    const cert= rdFile( obj.cert );
    const ca= rdFile( obj.ca );

    if( name === config.mainCert ) {
      secureOptions= { key, cert, ca };
    }

    if( certificates.has(name) ) {
      stop(`Duplicate certificate name ${name}`);
    }

    const {context}= tls.createSecureContext({ key, cert, ca });
    certificates.set(name, context);
  }

  // Create host entries
  const hosts= new Map();
  for( const name in config.hosts ) {
    const obj= config.hosts[name];
    hosts.set(name, HostEntry.create(name, obj, certificates));
  }

  function findHostOrUnkown(domain) {
    const hostEntry= hosts.get(domain);
    return hostEntry ? hostEntry : HostEntry.Unknown;
  }

  // Create proxy instance
  const proxy= httpProxy.createProxyServer({
    xfwd: true,
    ws: true
  });

  proxy.on('error', e => {
    logger.error('Caught proxy error:', e);
  });

  // Stat counters -> all of them are big ints to prevent overflows
  let websocketCount= 0n, prevWebsocketCount= 0n;
  let requestCount= 0n, prevRequestCount= 0n;
  let activeWebsocketCount= 0n, maxActiveWebsocketCount= 0n;
  proxy.on('open', () => {
    websocketCount++;
    activeWebsocketCount++;
    maxActiveWebsocketCount= genericMax(maxActiveWebsocketCount, activeWebsocketCount);
  });
  proxy.on('close', () => activeWebsocketCount--)
  proxy.on('proxyRes', () => requestCount++);

  // Start interval timer to print stats
  setInterval( () => {
    logger.stats(
      {requests: requestCount - prevRequestCount}, ` requests (total ${requestCount}),`,
      {websockets: websocketCount- prevWebsocketCount}, ` websockets (total ${websocketCount}) `,
      '(active ', {activeWebsocketCount: maxActiveWebsocketCount}, ')'
    );

    // Reset the stats counters for the next 30s time window
    prevWebsocketCount= websocketCount;
    prevRequestCount= requestCount;
    maxActiveWebsocketCount= activeWebsocketCount;
  }, 30000);

  // Http proxy server handling insecure requests
  const insecureServer= http.createServer( (req, res) => {
    findHostOrUnkown(req.headers['host']).handleInsecureWebRequest(proxy, req, res);
  }).listen( config.httpPort, function() { logger.log(`Listening http port: ${this.address().port}`); });

  // Handle insecure websockets
  insecureServer.on('upgrade', (req, socket, head) => {
    findHostOrUnkown(req.headers['host']).handleInsecureUpgradeRequest(proxy, req, socket, head);
  });

  // Create secure options for https endpoint
  if( !secureOptions ) {
    stop(`Missing main certificate: '${config.mainCert}'`);
  }

  secureOptions.SNICallback= function (domain, cb) {
    findHostOrUnkown(domain).handleSNICallback(cb);
  };

  // Https proxy server handling secure requests
  const secureServer= https.createServer( secureOptions, (req, res) => {
    findHostOrUnkown(req.headers['host']).handleSecureWebRequest(proxy, req, res);
  }).listen( config.httpsPort, function() { logger.log(`Listening https port: ${this.address().port}`); });

  // Handle secure websockets
  secureServer.on('upgrade', (req, socket, head) => {
    findHostOrUnkown(req.headers['host']).handleSecureUpgradeRequest(proxy, req, socket, head);
  });
})();
