# Elastic Search Index Management Service

The elastic search index management service.  The elastic search management service allows users to

 - Create new indexes
 - Set the read aliases for an index
 - Set the write alias for an index
 - Copy indexes after mapping updates

For all defined models FinEsDataModels.

## Setup

This is a default fin service.  You can [see the service definition here](../../services/init/fcrepo/service/es-index-management.jsonld.json).

You can disable this service by setting the `DISABLE_FIN_SERVICE` env variable

```bash
DISABLE_FIN_SERVICE=es-index-management
```

## Usage

  - `GET /es-index-management/[model-name]/index` - Get a list of all indexes for a model
  - `GET /es-index-management/index/[index-name]` - Get all information about an index
  - `POST /es-index-management/[model-name]/index` - Create a new index for a model
  - `DELETE /es-index-management/index/[index-name]` - Delete index
  - `PUT /es-index-management/[model-name]/index/[index-name]?alias=[alias-type]` - Set the model alias for an index.  The `alias-type` can be `read` or `write`.
  - `POST /es-index-management/[model-name]/recreate-index/[index-name]` - Copy the provided index over to a new index. This is useful for recreating indexes with new mappings.
  - `GET /es-index-management/task-status/[task-id]` - Get elastic search background task status.  When recreating an index, a `task-id` is returned.  This can be used to check the status of the task.