## API Service

The API service is an extendable service layer that provides each data model with an API.  The API service loads all models, creating a new endpoint for each model that has an api property where the api property is an express router object. The API service will map the model name to the endpoint name.  For example, the `item` model will be available at `/api/item`, with all subpaths being mapped to the model's api router.

## Setup

This is a default fin service.  You can [see the service definition here](../../services/init/fcrepo/service/api.jsonld.json).

You can disable this service by setting the `DISABLE_FIN_SERVICE` env variable

```bash
DISABLE_FIN_SERVICE=api
```