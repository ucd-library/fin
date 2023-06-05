# Fin Data Models

Fin does not provide any default data models.  It is up to each application to define their own.  Fin is based on the priniciple that applications will access data via Elastic Search.  Therefore the default data models described will be for Elastic Search, extending an Elastic Search data model base class.  However, you can write your own data models for any other data store.

Additionally, a data model COULD write data to multiple stores, if you so desired.

  - [Elastic Search Data Model](./elastic-search.md) - How to implement standard fin data models for Elastic Search

Contents:

  - [Defining a Data Model](#defining-a-data-model)
  - [API](#api)
  - [Model](#model)
  - [Deploying Data Models](#deploying-data-models)
  - [Data Models and DBSync Service](#data-models-and-dbsync-service)
  - [Validation](#validation)
  - [Transforms](#transforms)

## Defining a Data Model

The data model should expose three properties:
  - `api` - An express router object that will be mounted at `/api/[model-name]`
  - `model` - The business logic for the data model
  - `schema` - The Elastic Search schema for the data model

Normally each model is stored in a separate folder, with an `index.js` file that exports the three properties.  For example:

```javascript
module.exports = {
  api : require('./api.js'),
  model : require('./model.js'),
  schema : require('./schema.json')
}
```

## API

An API is an express router object that will be mounted at `/api/[model-name]`.  The API should be defined in a separate file, and exported as the `api` property of the data model.  For example:

```javascript
const router = require('express').Router();
const model = require('./model.js');

router.get('/*', async (req, res) => {
  // do stuff
});

module.exports = router;
```

## Model

The model is the business logic for the data model.  It should be defined in a separate file, and exported as the `model` property of the data model.  Elastic Search models should extend the [Elastic Search Data Model](./elastic-search.md) which is part of the `@ucd-lib/fin-service-utils` package and is the recommend way.  However, you can write your own model if you want. See below.

Developers, [see full ElasticSearchModel source here](../../services/fin/node-utils/lib/elastic-search/index.js)

The most basic model would look something like this:

```javascript
const {dataModels} = require('@ucd-lib/fin-service-utils');
const {FinDataModel} = dataModels;

class ItemModel extends ElasticSearchModel {

  constructor() {
    // base name for model
    super('item');

    // the transform service to use for this model.
    this.transformService = 'es-item-transform'
  }

  // you must override this function.  It should return true if the id 
  // to the model.  The fin standard practice is to 
  // bind a model to a root path in the ldp. In this case all `/item` paths
  // would bind to this model.
  is(id) {
    if( id.match(/^\/item\//) ) return true;
    return false;
  }

}

module.exports = new ItemModel();
```

## Deploying Data Models

Data models should be built into the base fin service image, extending the image.  This is done by adding a `models` directory to the `/fin/services` directory.  The `Dockerfile` should look something like this:

```dockerfile
FROM gcr.io/ucdlib-pubreg/fin-base-service

COPY models /fin/services/models
```

Fin will always look for models in the `/fin/services/models` directory.

## Data Models and DBSync Service

Data models are designed to be used with sync services.  The dbsync service is responsible for keeping data in the backend data store (ex: Elastic Search) up to date with the data in Fedora.  When a ActiveMQ update message comes in, the `is(id, types, workflows)` method is called.  If the `is()` method returns true, the models `update()` or `remove()` method is called to update the backend data store.

## Validation

Dbsync can validate database objects and store the results of the validation for viewing in fin admin.  Validations can return `errors`, `warnings` and `comments`.  Validations will show as stats on the fin admin dashbard as well as in the `dbsync` and `Path Info` pages.  For validation to occure, 
the model must define a `validate()` method and a `get()` method.  

First the `get()` method is called to get the current state of the object in the database.  The `get()` method should return the current
object regardless of container id passed.  

For this example, lets say containers `/item/foo` and `/item/foo/bar` are mapped to the same database model `/item/foo`.  Then the `get()` method should return the same object for `model.get('/item/foo')` and `model.get('/item/foo/bar')`.

The validate method should take the response of the `get()` method and return a validation object.  The validation object should have the following properties:

  - `id` - `String`. database id.  For example above this is `/item/foo`
  - `errors` - `Array` of errors.  Contents can be anything.  Simple strings recommened.
  - `warnings` - `Array` of warnings.  Contents can be anything.  Simple strings recommened.
  - `comments` - `Array` of comments.  Contents can be anything.  Simple strings recommened.


```javascript

## Transforms

Models can define their our transforms.  The transform is used during the extraction of data from Fedora.  To have a model define a transform, define the `transformService` in the model and the `index.js` file would export a `transform` property.  For example:

Model

```javascript
const {dataModels} = require('@ucd-lib/fin-service-utils');
const {FinDataModel} = dataModels;

class ItemModel extends ElasticSearchModel {

  constructor() {
    // base name for model
    super('item');

    // the transform service to use for this model.
    this.transformService = 'es-item-transform'
  }
}

module.exports = new ItemModel();
```

index.js

```javascript
module.exports = {
  model : require('./model.js'),
  transform : require('./transform.js')
}
```

This transform would then be available at `/fcrepo/rest/[path]/svc:es-item-transform`.  See the [transform service](../service-types/transform-service/README.md) for more information.