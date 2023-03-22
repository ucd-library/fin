# DbSync Service

DbSync is a service that synchronizes data fcrepo and external databases.  DbSync uses registered [FinDataModels](../data-models/README.md) to update/remove data from the external database.

DbSync listens to ActiveMQ fcrepo update events as well as `fin` reindex events, fetch the container data through the transform service (if provided, otherwise container json-ld), then call the data models `update()` or `remove()` method.

## Configuration

DbSync comes pre-configured.  All you need to do is extend the base `fin` service image, ensuring your data models are mounted to the proper location. See [data models](../data-models/README.md) for more information.

## Fcrepo Container to ES Document Storage

When create/update event for fcrepo resources are received, dbsync will find all [FinEsDataModels](../data-models/elastic-search.md) that binds to the resource (via the `is()` method).  If a model is found, dssync will use the provided `transformService` property from the model as the transform service to access to resource, otherwise the container json-ld is fetch.  Ex.  If the `transformService` property is `es-item-transform` and the fin container path is `/foo/bar`, dbsync will use the `/fcrepo/rest/foo/bar/svc:es-item-transform` to retrieve the resource from fcrepo.

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

Dbsync uses two postgres tables and they are great resources to understand what the current state of dbsync is.

Please see table documentation below for more information.

### dbsync.event_queue

Each ActiveMQ event is added to this table by fin path.  Dbsync then pulls this table for the oldest event in the table and processes it.  This table acts a queue of events to process, allowing dbsync to process events one at a time, using the oldest event first as multiple update events per container can be received when large updates are happening.

### dbsync.update_status

This is the best table to debug what is happening with dbsync.  Each time dbsync processes an event, it will update the `update_status` table with the current status of the event.  So the entire state (including errors and ignored events) are stored in this table.

Table columns:
  - `updated` - timestamp of when the event status was updated
  - `path` - fin path of the event
  - `update_types` - fcrepo or fin update event types
  - `container_types` - `@type` of the container
  - `workflow_types` - `fin workflow` types run on the container (if any).
  - `event_id` - ActiveMQ event id or fin event id
  - `event_timestamp` - timestamp from the ActiveMQ event or fin event
  - `action` - action taken on the event (ex. `updated`, `deleted`, `ignored`, `error`)
  - `transform_service` - full url of the transform service used to retrieve the resource from fcrepo
  - `model` - data model used to process the event
  - `message` - additional message about what dbsync did
  - `db_response` - Database response from the update/delete request
  - `source` - This will store anything in the transformed containers `source` property or the first node with a `_.source` property.
