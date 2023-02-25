# FIN Server Documentation

Fin is a microservice based Fedora repository (fcrepo).  It is built using NodeJS and Docker.  Fin wraps fcrepo and provides a default set of services and opinions.  The fin wrapper extends the fcrepo API allowing users to add additional services to the fcrepo container.  Fin also provides a default set of services that can be used to extend the fcrepo container.  These services are:
 - [FinACL](../services/fin-acl)] - An opinionated wrapper around the WebAC implementation.  FinAC provides temporal access control, allowing users access to resources for a limited time.
 - Extendable Data Models - Both the Fin API layer and Essync service depend on application specific data models.  These models define the fcrepo to Elastic Search document transformation, the Elastic Search indexing schema, and the API layer to interact with the data model. (example, see DAMS services/models directory)
 - [Gateway](../services/gateway) - Wrapper and proxy

## Fin Core

There are three services at the core of Fin:

- [Fedora](../serivces/fcrepo)
  - A [Fedora Commons](https://wiki.duraspace.org/display/FEDORA6x/) container
-  
- Redis
  - A key/value store [Redis](https://redis.io/) is used for storing sessions, admins, service signatures and available to all other local services to be leveraged for basic storage (ex: the [basic-auth](../services/basic-auth) service uses Redis store username/password information).
- [Fin Server](../server)
  - A NodeJS/ExpressJS server that acts as a proxy to route Fin HTTP requests to desired services.  The Fin server also adds endpoints for handling some auth functionality such as logout and admin administration.

## Services

Fin is built using composable microservices.  If you want to develop on or deploy Fin, this is recommended reading.

[Service Documentation](../services/README.md)

## FIN CLI

[https://github.com/UCDavisLibrary/fin-cli](https://github.com/UCDavisLibrary/fin-cli)

A command line interface and shell for interactive with Fin.  Built using the [fin-node-api](https://github.com/UCDavisLibrary/fin-node-api) the CLI provides functionality for interacting with Fin and Fedora.  It provides a simple CLI for performing all [Fedora HTTP API requests](https://wiki.duraspace.org/display/FEDORA4x/RESTful+HTTP+API) as well as working with [Fin services](../services/README.md), WebAC/acl the Fin way and authentication.

Install CLI (NodeJS w/ NPM Required)

```bash
npm install -g fin-cli
```

## Administrators

Administrators are users that access the fedora component with webac disabled. This allows access to all parts of the fedora repository as well as access to admin only parts of the Fin server.  If you  want to add a new administrator to your system.  This is accomplished with this commands.  Note, this assumes you are running from a fresh Fin instance and uses the [https://github.com/UCDavisLibrary/fin-cli](https://github.com/UCDavisLibrary/fin-cli)

First we want to grant our Fin CLI temporary super user access.  We can do this with the login commands --super-user flag:

```bash
fin login --super-user <username>
```

You will then be prompted for the servers jwt secret and jwt issuer.  Provide those to the CLI and provide a username you want to login as (it can be anything, new containers will be created at this user).

Now that we are a super user you can add admins to the system.

```bash
fin acl add-admin quinn
```

This will give the user `quinn` admin access to the system.  If you are using CAS authentication with a subdomain (ex: ucdavis.edu), then the command should be:

```bash
fin acl add-admin quinn@ucdavis.edu
```

Which gives user `quinn@ucdavis.edu` admin access to the system.

Finally, logout with ```fin logout```.  Now when you log back in as `quinn` or `quinn@ucdavis.edu` the user will have admin permissions. 

## Fin Config (Environmental Variables)

See docs [here](env-config.md)

## Demo

[UC Davis DAMS Demo](../docker/ucd-dams/README.md).  A great quick start and overview of Fin services in action.

## CORS

See Fin implementation details [here](cors.md)

## Browser Quirks

See docs [here](browser-quirks.md)
