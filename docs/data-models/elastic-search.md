# Elastic Search Data Model

The Elastic Search data model is a base class for creating data models that store data in Elastic Search.  It provides a number of helper methods for creating and updating Elastic Search documents.


## Model

The model is the business logic for the data model.  It should be defined in a separate file, and exported as the `model` property of the data model.  Elastic Search models should extend the `ElasticSearchModel` which is part of the `@ucd-lib/fin-service-utils` package.

Developers, [see full ElasticSearchModel source here](../../services/fin/node-utils/lib/elastic-search/index.js)

The most basic model would look something like this:

```javascript
const {dataModels} = require('@ucd-lib/fin-service-utils');
const {FinEsDataModel} = dataModels;

class ItemModel extends ElasticSearchModel {

  constructor() {
    // base name for model and elastic search indexes
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

This model exposes standard functions for interacting with fin Elastic Search documents, including:

  - `search` - Search for documents
  - `get` - Get a single document
  - `all` - Get all documents, via batched callbacks
  - `update` - Update a node in a document
  - `delete` - Delete a node in a document
  - `getEsRoles` - get the finac roles for this document
  - `getDefaultIndexConfig` - get the default elastic search index config for this document.  the mappings are set from the `schema.json` file.

## API

You can use the `defaultEsApiGenerator` to create a standard API around your Elastic Search model.  This will create a standard REST API for your model, including:

  - `POST /api/[model-name]/` - Search for documents
  - `GET /api/[model-name]/` - Get all documents
  - `GET /api/[model-name]/:id` - Get a single document

Here is an example that uses the `defaultEsApiGenerator` to create an API and then adds a `GET /api/[model-name]/all-lables` endpoint.

```javascript
const {dataModels, logger} = require('@ucd-lib/fin-service-utils');
const model = require('./model.js');
const {defaultEsApiGenerator} = dataModels;
const {Router} = require('express');

let router = Router();

// you want to define your new routes BEFORE you call defaultEsApiGenerator
router.get('/all-labels', async (req, res) => {
  try {
    let labels = await model.allLabels();
    res.json(labels);
  } catch(e) {
    res.statu(500).json({
      error : true,
      message : 'Error with '+model.id+' labels retrieval',
      details : e.message
    });
  }
});

// router is optional, if not provided a new router will be created
// and returned.  That looks like this:
// const router = defaultEsApiGenerator(model);
defaultEsApiGenerator(model, {router});

module.exports = router;
```


### Overriding getDefaultIndexConfig()

ex:

```javascript
class MyAppsBaseEsModel extends ElasticSearchModel {
  getDefaultIndexConfig(schema) {
    let newIndexName = `${this.modelName}-${Date.now()}`;

    return {
      index: newIndexName,
      body : {
        settings : {
          // your new settings here
        },
        mappings : schema
      }
    }
  }
}
```

## Schema

The schema is the Elastic Search mappings for the data model.  It should be defined in a separate file, and exported as the `schema` property of the data model.  For example:

```json
{
  "dynamic": false,

  "properties": {
    "@id": {
      "type": "keyword"
    },

    "@graph.@id": {
      "type": "keyword"
    },

    "@graph.name": {
      "type": "text"
    },

    "@graph.description": {
      "type": "text"
    },

    "@graph.date": {
      "type": "date"
    }
  }
}
```
