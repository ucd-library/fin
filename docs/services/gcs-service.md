# Google Cloud Storage (GCS) Access Service

The GCS service allows access to files that are hosted in Google Cloud storage.  The primary reason files may be hosted in GCS; workflows producing derivative products keep the derivative products in GCS and the original files in Fedora.

## Setup

This is a default fin service.  You can [see the service definition here](../../services/init/fcrepo/service/gcs.jsonld.json).

You can disable this service by setting the `DISABLE_FIN_SERVICE` env variable

```bash
DISABLE_FIN_SERVICE=gcs
```

Then you must add your configuration file to fcrepo at `/fin/gcs/config.json`

```json
{
  "access" : [{ 
    "bucket" : "dams-client-products",
    "basePath" : "/item"
  }]
}
```

In this config example, all files in the `dams-client-products` bucket will be accessible via the fin `/item` path.  

Using the example ldp container `/item/1234/5678/1234-5678-1.tif` and say there is a derivative product `1234-5678-1.jpg` in the GCS bucket `dams-client-products`.  The derivative product will be accessible via the url `http://localhost:3000/item/1234/5678/1234-5678-1.tif/svc:gcs/dams-client-products/1234-5678-1.jpg`.

## Usage

The parts of the service url are, `fin-path`, `bucket`, `gcs-sub-path`.  A file stored in GCS at:

`gs://dams-client-products/1234/5678/1234-5678-1.tif/1234-5678-1.jpg`

can be accessed via the url:

`http://localhost:3000/item/1234/5678/1234-5678-1.tif/svc:gcs/dams-client-products/1234-5678-1.jpg`


### General Format

Google Cloud Storage URL:
gs://`[bucket]`/`[fin-path]`/`[gcs-sub-path]`

Fin URL:
https://`[fin-host]`/`[fin-path]`/svc:gcs/`[bucket]`/`[gcs-sub-path]`


## Access Control

Access to GCS files is controlled by the principals access to the file in Fedora.  If the principal has access to the file in Fedora, they will have access to the file in GCS.  If the principal does not have access to the file in Fedora, they will not have access to the file in GCS.

This is implemented via the standard preflight check to the Fedora container.  If access is allowed, the GCS service will proxy the request to the GCS file.
