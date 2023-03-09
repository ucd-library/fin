# FIN Server Documentation

Fin is a microservice based Fedora repository (fcrepo).  It is built using NodeJS and Docker.  Fin wraps fcrepo and provides a default set of services and opinions.  The fin wrapper extends the fcrepo API allowing users to add additional services to the fcrepo container.  Fin also provides a default set of services that can be used to extend the fcrepo container.  These services are:
 - [FinACL](../services/fin-acl)] - An opinionated wrapper around the WebAC implementation.  FinAC provides temporal access control, allowing users access to resources for a limited time.
 - Extendable Data Models - Both the Fin API layer and Essync service depend on application specific data models.  These models define the fcrepo to Elastic Search document transformation, the Elastic Search indexing schema, and the API layer to interact with the data model. (example, see DAMS services/models directory)
 - [Gateway](../services/gateway) - Wrapper and proxy

## Fin Core

Here are the major microservices at the core of Fin:

- Fedora - A [Fedora Commons](https://wiki.duraspace.org/display/FEDORA6x/) container
- PostgreSQL
- Redis
- Gateway - A NodeJS/ExpressJS server that acts as a proxy to route Fin HTTP requests to desired services.  The Fin server also adds endpoints for handling some auth functionality such as logout and admin administration.

# Topics

  - [Fin Service Documentation](./services/README.md)
  - [Fin Service Types](./services-types)
  - [Fin Data Models](./data-models/README.md)
  - [Fin Config](./env-config.md)
  - Other Tech Bits
    - [CORS](./cors.md)
    - [Browser Quirks](./browser-quirks.md)

## FIN CLI

TODO: Update this section

A command line interface and shell for interactive with Fin.  Built using the fin-node-api the CLI provides functionality for interacting with Fin and Fedora.  It provides a simple CLI for performing all [Fedora HTTP API requests](https://wiki.duraspace.org/display/FEDORA4x/RESTful+HTTP+API) as well as working with [Fin services](../services/README.md), WebAC/acl the Fin way and authentication.

Install CLI (NodeJS w/ NPM Required)

```bash
npm install -g fin-cli
```