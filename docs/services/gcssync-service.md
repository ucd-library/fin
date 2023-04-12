## Google Cloud Storage (GCS) Sync Service

The google cloud sync service allows applications to:
  - sync files from GCS to Fedora
  - sync files from Fedora to GCS

## Setup

Add the following to `/fin/gcs/config.json`

```json
{
  "sync" : {
    "containers" : [{
      "bucket" : "dams-client-{{GCS_BUCKET_ENV}}",
      "basePath" : "/application/ucd-lib-client/item",
      "direction" : "fcrepo-to-gcs",
      "initDataHydration" : true
    }]
  }
}
```

In this config example, the container `/application/ucd-lib-client` as well as it's children will be synced to the GCS bucket `dams-client-{{GCS_BUCKET_ENV}}`.  The `initDataHydration` flag will cause the service to sync all files from GCS to Fedora on cold start where no data is present in `/application/ucd-lib-client`.

### Config Properties

  - `bucket` - the GCS bucket to sync to/from.  
    - You can use environment variables in the bucket name, surrounded by `{{` and `}}`.  For example, `dams-client-{{GCS_BUCKET_ENV}}` will be replaced with `dams-client-dev` if the `GCS_BUCKET_ENV` environment variable is set to `dev`.
    - If the direction is `gcs-to-fcrepo`, you need to enable PubSub events on the bucket, see PubSub section below.
  - `basePath` - the base path to sync.  This path will be used to determine the path to sync to/from GCS.  For example, if the `basePath` is `/application/ucd-lib-client/item` and the path to sync is `/application/ucd-lib-client/item`, the file will be synced to/from `gs://dams-client-{{GCS_BUCKET_ENV}}/application/ucd-lib-client/item`.
  - `direction` - the direction to sync.  Can be `fcrepo-to-gcs` or `gcs-to-fcrepo`.
    - `enabledDeletes` - if `direction` is `fcrepo-to-gcs`, this flag will enable deletes from Fedora to GCS.  This is useful if you want to delete files from GCS when they are deleted from Fedora.  However, this is often not the case, so the default is `false`. 
  - `initDataHydration` - if true, the service will sync all files from GCS to Fedora on cold start where no data is present in the `basePath`.  This is useful for initial data hydration or if you want to sync all files from GCS to Fedora.

## PubSub Events (GCS to Fedora)

PubSub events must be enabled for `gcs-to-fcrepo` to work. See [here](https://cloud.google.com/storage/docs/reporting-changes#command-line) for information on how to enable PubSub events.

- The topic name MUST be the same as the bucket name.
- The subscription name on the topic must be created on the topic and set in the `config.js` as `config.google.pubSubSubscriptionName`, which uses the `GOOGLE_PUBSUB_SUBSCRIPTION_NAME` environment variable and defaults to `local-dev`.