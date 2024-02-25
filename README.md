# Egimoto Infrastructure Repo

This is a mono repo of things run on [egimoto](https://www.egimoto.com) and
related websites, plus things created to keep the former running.

Npm packages from this repo can be installed with [GitPkg](https://gitpkg.vercel.app/). This is a 
useful service that allows installing npm packages located in sub-directories of a GitHub
repository.

## Services

- __Timestamp service:__ A simple service for cryptographically signed timestamps
  
  Install via GitPkg: `npm install 'https://gitpkg.now.sh/PreyMa/egimoto/timestamp?main'`

- __Proxy:__ Proxy server handling and distributing incoming http and https traffic

  Install via GitPkg: `npm install 'https://gitpkg.now.sh/PreyMa/egimoto/proxy?main'`

- __Digital Voice Dashboard:__ Dashboard for the digital voice radio [MMVDM software](https://github.com/g4klx/MMDVMHost)

  Install via GitPkg: `npm install 'https://gitpkg.now.sh/PreyMa/egimoto/digital-voice-dashboard?main'`

- __MMDVM Monitor:__ Monitoring application for the [MMVDM software](https://github.com/g4klx/MMDVMHost) that parses log messages to
  send MQTT messages

  Install via GitPkg: `npm install 'https://gitpkg.now.sh/PreyMa/egimoto/mmdvm-monitor?main'`

## Packages

- __Mqtt Logger:__ A simple framework that allows remote logging by sending messages
  to a mqtt broker

  Install via GitPkg: `npm install 'https://gitpkg.now.sh/PreyMa/egimoto/mqtt-logger?main'`

## Git Namespaces

Commits and Pull-Requests use a prefix to indicate where they belong to. Each service and package
has a unique prefix. For example, if you were to make a commit related to the proxy server service
with the summary "Improved feature X" your commit title is supposed to read as "Proxy: Improved feature X".
The list of all the namespaces is down below. Also, your commit title should always start capitalized.

- This root ReadMe file: `ReadMe`
- Timestamp service: `Timestamp`
- Proxy server: `Proxy`
- Digital Voice Dashboard: `DVD`
- MMDVM Monitor: `MMDVM Monitor`
- Mqtt Logger: `Logger`
