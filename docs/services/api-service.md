## API Service

The API service is an extendable service layer that provides each data model with an API.  The API service loads all models, creating a new endpoint for each model that has an api property where the api property is an express router object. The API service will map the model name to the endpoint name.  For example, the `item` model will be available at `/api/item`, with all subpaths being mapped to the model's api router.

## Setup

Put the following in `/service/api`

```json
{
  "@id": "",
  "@type": [
    "http://digital.ucdavis.edu/schema#Service",
    "http://digital.ucdavis.edu/schema#GlobalService"
  ],
  "urlTemplate": "http://api:3000{{svcPath}}",
  "description": "Data Model APIs",
  "identifier": "api",
  "title": "api",
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

Note.  This is a gobal service, so it's not accessesed via `/fcrepo/rest/[fin-path]/scv:api`.  It's accessed via `/api`.