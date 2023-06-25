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


## Packages

- __Mqtt Logger:__ A simple framework that allows remote logging by sending messages
  to a mqtt broker

  Install via GitPkg: `npm install 'https://gitpkg.now.sh/PreyMa/egimoto/mqtt-logger?main'`


