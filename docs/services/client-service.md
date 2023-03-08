# Client Service

The client service should be the primary UI for the fin application.  The client service will be a catch-all for any request to redirected to any registered service, custom or fin.

## Setup

```json
{
  "@id": "",
  "@type": [
    "http://digital.ucdavis.edu/schema#ClientService",
    "http://digital.ucdavis.edu/schema#Service"
  ],
  "url": "http://[client-service-host]:8000",
  "description": "Fin Client UI",
  "identifier": "[client-id]",
  "title": "[client-name]",
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

Couple additional notes.  Unlink most services, the client id just needs to be unique, but is not reflexed in the url. 