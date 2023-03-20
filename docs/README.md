# FIN Server Documentation

Fin is a microservice based Fedora repository (fcrepo).  It is built using NodeJS and Docker.  Fin wraps fcrepo and provides a default set of services and opinions.  The fin wrapper extends the fcrepo API allowing users to add additional services to the fcrepo container.  Fin also provides a default set of services that can be used to extend the fcrepo container.  

## Fin Core

Here are the major microservices at the core of Fin:

- Fedora - A [Fedora Commons](https://wiki.duraspace.org/display/FEDORA6x/) container
- PostgreSQL
- Redis
- Gateway - A NodeJS/ExpressJS server that acts as a proxy to route Fin HTTP requests to desired services.  The Fin server also adds endpoints for handling some auth functionality such as logout and admin administration.
- API - Extendable API service to power applications
- ElasticSearch - A search engine for indexing and searching data
- FinAC - An opinionated WebAC wrapper
- GCS - A Google Cloud Storage service for accessing binary data
- Keycloak - An authentication service that integrates with Keycloak
- Essync - A service for syncing data between Fcrepo and ElasticSearch
- Workflow - A service for managing and monitoring 3rd party workflow frameworks

# Topics

  - [Fin Service Documentation](./services)
  - [Fin Service Types](./service-types)
  - [Fin Data Models](./data-models)
  - [Fin Config](./env-config.md)
  - Other Tech Bits
    - [CORS](./cors.md)
    - [Browser Quirks](./browser-quirks.md)

## FIN CLI

TODO: Update this section

A command line interface and shell for interactive with Fin.  Built using the fin-node-api the CLI provides functionality for interacting with Fin and Fedora.  It provides a simple CLI for performing all [Fedora HTTP API requests](https://wiki.lyrasis.org/display/FEDORAM6M1P0/REST+API+Specification) as well as working with [Fin services](./services), WebAC/acl the Fin way and authentication.

Install CLI (NodeJS w/ NPM Required)

```bash
npm install -g fin-cli
```