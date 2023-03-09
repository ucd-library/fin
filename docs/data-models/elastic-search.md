# Elastic Search Data Model

The Elastic Search data model is a base class for creating data models that store data in Elastic Search.  It provides a number of helper methods for creating and updating Elastic Search documents.

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

The model is the business logic for the data model.  It should be defined in a separate file, and exported as the `model` property of the data model.  Elastic Search models should extend the `ElasticSearchModel` which is part of the `@ucd-lib/fin-service-utils` package.

The most basic model would look something like this:

```javascript
const {ElasticSearchModel} = require('@ucd-lib/fin-service-utils');

class ItemModel extends ElasticSearchModel {

  constructor() {
    // base name for model and elastic search indexes
    super('item');
  }

  // you must override this function.  It should return true if the id or
  // or the types array bind to the model.  The fin standard practice is to 
  // bind a model to a root path in the ldp. In this case all `/item` paths
  // would bind to this model.
  is(id, types=[]) {
    if( id.match(/^\/item\//) ) return true;
    return false;
  }

}

module.exports = new ItemModel();
```

This model exposes standard functions for interacting with fin Elastic Search documents, including:

  - `search` - Search for documents
  - `get` - Get a single document
  - `hasSyncMethod` - Required for ALL models in fin.  This is already wired up to work with `essync`
  - `all` - Get all documents, via batched callbacks
  - `update` - Update a node in a document
  - `delete` - Delete a node in a document
  - `getEsRoles` - get the finac roles for this document
  - `getDefaultIndexConfig` - get the default elastic search index config for this document.  the mappings are set from the `schema.json` file.

## Schema

The schema is the Elastic Search mappings for the data model.  It should be defined in a separate file, and exported as the `schema` property of the data model.  For example:

```json
{
  "dynamic": false,

  "properties": {
    "title": {
      "type": "text"
    },
    "description": {
      "type": "text"
    },
    "date": {
      "type": "date"
    }
  }
}
```
