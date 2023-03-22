# Elastic Search Index Management Service

The elastic search index management service.  The elastic search management service allows users to

 - Create new indexes
 - Set the read aliases for an index
 - Set the write alias for an index
 - Copy indexes after mapping updates

For all defined models FinEsDataModels.

## Setup

Put the following in: `/service/es-index-management`

```json
{
  "@id": "",
  "@type": [
    "http://digital.ucdavis.edu/schema#Service",
    "http://digital.ucdavis.edu/schema#ProxyService"
  ],
  "urlTemplate": "http://es-index-management:3000/{{fcPath}}{{svcPath}}",
  "description": "Manage Elastic Search aliases and indexes",
  "identifier": "es-index-management",
  "title": "Elastic Search Index Management Service",
  "@context": {
    "title": {
      "@id": "http://purl.org/dc/elements/1.1/title"
    },
    "identifier": {
      "@id": "http://purl.org/dc/elements/1.1/identifier"
    },
    "urlTemplate": {
      "@id": "http://digital.ucdavis.edu/schema#urlTemplate"
    },
    "description": {
      "@id": "http://purl.org/dc/elements/1.1/description"
    }
  }
}
```

## Usage

  - `GET /svc:es-index-management/[model-name]/index` - Get a list of all indexes for a model
  - `GET /svc:es-index-management/[model-name]/index/[index-name]` - Get all information about an index
  - `POST /svc:es-index-management/[model-name]/index` - Create a new index
  - `DELETE /svc:es-index-management/[model-name]/index` - Delete index
  - `PUT /svc:es-index-management/[model-name]/index/[index-name]?alias=[alias-type]` - Set the model alias for an index.  The `alias-type` can be `read` or `write`.
  - `POST /svc:es-index-management/[model-name]/recreate-index/[index-name]` - Copy the provided index over to a new index. This is useful for recreating indexes with new mappings.
  - `GET /svc:es-index-management/[model-name]/task-status/[task-id]` - Get elastic search background task status.  When recreating an index, a `task-id` is returned.  This can be used to check the status of the task.



