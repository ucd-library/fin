# Fin Label Service

The fin label service is a lookup service for storing and retrieving labels for uri's.  The are two properties that are supported `http://schema.org/name` and `http://www.w3.org/2000/01/rdf-schema#label`.

## Setup

No setup is required for the label service.  The `gateway` service handles the label service requests as well as updates to the label service backend.

## Usage 

### Adding Labels

To add a label to the label service, simply add a `http://schema.org/name` or `http://www.w3.org/2000/01/rdf-schema#label` property to a resource container of type `http://digital.ucdavis.edu/schema#Service` and `http://digital.ucdavis.edu/schema#LabelService` .  The label service will automatically update the label service backend.

Example: 

```ttl
@prefix ucdlib: <http://digital.ucdavis.edu/schema#> .

<> a ucdlib:LabelService,
     ucdlib:Service .

<http://en.wikipedia.org/wiki/Cat>
	<http://schema.org/name> "Cat" .

<http://en.wikipedia.org/wiki/Dog>
	<http://schema.org/name> "Dog" .
```

### Retrieving Labels

To retrieve a label from the label service, simply make a GET request to the `/label` service with the uri in the path.  The label service will return a JSONLD object that is a `@graph` of `@graph`s.  The outer graph is the container that defined the label, the inner graph is the resource that was labeled.

Example:

`GET /label/http%3A%2F%2Fen.wikipedia.org%2Fwiki%2FCat`

```json
{
  "@graph": [
    {
      "@id": "/collection/ark:/pets/awesome/wiki",
      "@graph": [
        {
          "@id": "http://en.wikipedia.org/wiki/Cat",
          "http://schema.org/name": [
            {
              "@value": "Cat"
            }
          ]
        }
      ]
    }
  ]
}
```

## Labels and Transform Services

When use the transform services `utils.add()` method, any uri property that is found will automatically be looked up in the label service.  If a label is found, it will be added to the transformed object.

Example:

Container:

```json
{
  "http://schema.org/keywords": [{"@id": "http://en.wikipedia.org/wiki/Cat"}],
}
```

Then using the transform utils:

```javascript
  utils.ns({
    "schema": "http://schema.org/"
  });

  await utils.add({
    attr : 'keywords',
    value : ['schema', 'keywords'],
    type : 'id'
  });
```
_Note: If the label service should match using `@id`, it's necessary to specify `type : 'id'` above._

Will result in:

```json
{
  "keywords": [{
    "@id": "http://en.wikipedia.org/wiki/Cat",
    "name" : "Cat"
  }]
}
```

## Porting HDT file to label service

Use the NPM `hdt` package.

htd-to-label.js
```javascript
const hdt = require('hdt');
const path = require('path');
const fs = require('fs');

const file = process.argv[2];

(async function() {
  let hdtDoc = await hdt.fromFile(file);

  let jsonld = [{
    '@id' : '',
    '@context' : {
      ucdlib: 'http://digital.ucdavis.edu/schema#' 
    },
    '@type' : ['ucdlib:LabelService', 'ucdlib:Service'],
  }]

  let result = await hdtDoc.searchTriples();
  for( let quad of result.triples ) {
    jsonld.push({
      '@id' : quad.subject.value,
      [quad.predicate.value] : quad.object.value
    });
  }
  
  let fileInfo = path.parse(file);
  fs.writeFileSync(
    path.join(fileInfo.dir, 'labels.jsonld.json'),
    JSON.stringify(jsonld, null, 2)
  );
})();
```