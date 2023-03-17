# Essync

Essync is a service that synchronizes data between Elasticsearch and the fcrepo.  Essync uses registered data models with the `hasSyncMethod` function returning `true` when `essync` is passed.  It is recommended you extend the `ElasticSearchModel` class from `@ucd-lib/fin-service-utils` to ensure this is the case. See documentation on [data models](../data-models/elastic-search.md) for more information.

Essync listens to ActiveMQ fcrepo update events as well as `fin` reindex events and will update the Elasticsearch index accordingly.

## Configuration

Essync comes pre-configured.  All you need to do is extend the base `fin` service image, ensuring your data models are mounted to the proper location. See [data models](../data-models/README.md) for more information.

## Fcrepo Container to ES Document Storage

When create/update event for fcrepo resources are received, essync will attempt to find a data model that binds to the resource (via the `is()` method).  If a model is found, essync will use the provided `transformService` property from the model as the transform service to access to resource.  Ex.  If the `transformService` property is `es-item-transform` and the fin container path is `/foo/bar`, essync will use the `/fcrepo/rest/foo/bar/svc:es-item-transform` to retrieve the resource from fcrepo.

The transform service needs to respond with JSONLD document.  The JSONLD document should have an `@graph` property which is an array of nodes, and contain a `@id` property used to add like nodes to the same document in ElasticSearch.

Ex.  Given two containers `/foo/bar` and `/foo/baz` with the following transform service response:

```json
{
  "@id": "1234",
  "@graph" : {
    "@id": "/foo/bar",
    "name": "bar"
  }
}
```

```json
{
  "@id": "1234",
  "@graph" : {
    "@id": "/foo/baz",
    "name": "baz",
    "_": {
      "source" : {
        "type" : "git",
        "branch" : "main",
        "commit" : "1234"
      }
    }
  }
}
```

The resulting document in ElasticSearch would look like:

```json
{
  "@id": "1234",
  "@graph": [
    {
      "@id": "/foo/bar",
      "name": "bar",
      "_" : {
        "update" : "2018-01-01T00:00:00.000Z"
      }
    },
    {
      "@id": "/foo/baz",
      "name": "baz",
      "_" : {
        "update" : "2018-01-01T00:00:00.000Z",
        "source" : {
          "type" : "git",
          "branch" : "main",
          "commit" : "1234"
        }
      }
    }
  ]
}
```

Note.  It's `fin` standard practice to put any node `metadata` in the `_` property.  So feel free to add any additional metadata to the `_` object.

## Debugging

Essync uses two postgres tables and they are great resources to understand what the current state of essync is.

Please see table documentation below for more information.

### essync.update_log

Each ActiveMQ event is added to this table by fin path.  Essync then pulls this table for the oldest event in the table and processes it.  Think of this table as a queue of events to process, allowing essync to process events one at a time, using the oldest event first as multiple update events per container can be received when large updates are happening.

### essync.update_status

This is the best table to debug what is happening with essync.  Each time essync processes an event, it will update the `update_status` table with the current status of the event.  So the entire state (including errors and ignored events) are stored in this table.

Table columns:
  - `updated` - timestamp of when the event status was updated
  - `path` - fin path of the event
  - `update_types` - fcrepo or fin update event types
  - `container_types` - `@type` of the container
  - `event_id` - ActiveMQ event id or fin event id
  - `event_timestamp` - timestamp from the ActiveMQ event or fin event
  - `action` - essync action taken on the event (ex. `updated`, `deleted`, `ignored`, `error`)
  - `transform_service` - full url of the transform service used to retrieve the resource from fcrepo
  - `model` - data model used to process the event
  - `message` - additional message about what essync did
  - `es_response` - Elasticsearch response from the update/delete request
  - `source` - This will store anything in the transformed containers `source` property or the first node with a `_.source` property.
