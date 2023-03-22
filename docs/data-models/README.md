# Fin Data Models

Fin does not provide any default data models.  It is up to each application to define their own.  Fin is based on the priniciple that applications will access data via Elastic Search.  Therefore the default data models described will be for Elastic Search, extending an Elastic Search data model base class.  However, you can write your own data models for any other data store.

Additionally, a data model COULD write data to multiple stores, if you so desired.

  - [Elastic Search Data Model](./elastic-search.md) - How to implement standard fin data models for Elastic Search

## Deploying Data Models

Data models should be built into the base fin service image, extending the image.  This is done by adding a `models` directory to the `/fin/services` directory.  The `Dockerfile` should look something like this:

```dockerfile
FROM gcr.io/ucdlib-pubreg/fin-base-service

COPY models /fin/services/models
```

Fin will always look for models in the `/fin/services/models` directory.

## Data Models and DBSync Service

Data models are designed to be used with sync services.  The dbsync service is responsible for keeping data in the backend data store (ex: Elastic Search) up to date with the data in Fedora.  When a ActiveMQ update message comes in, the `is(id, types, workflows)` method is called.  If the `is()` method returns true, the models `update()` or `remove()` method is called to update the backend data store.