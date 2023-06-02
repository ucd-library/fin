# Reindex Service

The reindex service crawls the Fedora repository and sends reindex events all resources.  This is useful for reindexing the repository after a mapping update or model change.

The reindex service is part of the `dbsync` container, however this service only crawls the LDP container hierarchy and triggers ActiveMQ reindex events for each resource.  The actual reindexing action should be taken by any service listening to ActiveMQ events.  By default the `dbsync` container listens to ActiveMQ events and reindexes the resource when it receives a reindex event.

By default the reindex service will crawl the all `ldp:contains` properties.  Additional properties can be crawled by adding the `follow` query parameter.  The `follow` query parameter should be a comma seperated list of schema.org properties.  The reindex service will then crawl the `follow` properties as well as `ldp:contains` properties.  Ex: `?follow=hasPart`

## Setup

This is a default fin service.  You can [see the service definition here](../../services/init/fcrepo/service/reindex.jsonld.json).

You can disable this service by setting the `DISABLE_FIN_SERVICE` env variable

```bash
DISABLE_FIN_SERVICE=reindex
```

## Usage

  - `GET /[fin-path]/svc:reindex` - Reindex this and all child containers at this resource
    - `?status=true` - get the status of a reindex crawl
    - `?follow=[properties]` - Common seperated list of schema.org properties to follow.  Ex: `?follow=hasPart`

### CLI Usage

The `fin` cli can be used to reindex a resource as well. 

```bash
fin reindex start [fin-path] [options]
```

Check status of a reindex crawl:

```bash
fin reindex status [fin-path] [options]
```


## Reindex Event Structure

Headers

```json
{
  "edu.ucdavis.library.eventType" : "Reindex",
}
```

Body

```json
{
  "@id" : "[fin-path]",
  "@type" : []
}
```

## Crawling

By default the reindex service will crawl the all `ldp:contains` properties.  Additional properties can be crawled by adding the `follow` query parameter.  The `follow` query parameter should be a comma seperated list of schema.org properties.  The reindex service will then crawl the `follow` properties as well as `ldp:contains` properties.  Ex: `?follow=hasPart`