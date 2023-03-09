# Fin Workflow Service

The workflow service is responsible for starting and monitoring workflows.  The workflow itself is run in a third party service.  Currently, the only supported workflow is Google Cloud Workflows, but other services could be added in the future.  This documentation will cover how to setup and run a Google Cloud Workflow.

## Setup

The workflow definition file should exist at: `/fin/workflows/config.json`

### Fin Base Workflows Definition:

```js
{
  "defaults" : Object,
  "definitions" : Object
}
```

 - `defaults`: Default configuration variables.  If a workflow does not defined a parameter, the default will be used.
 - `definitions`: Object were the key is the workflow name and the value is an Object containing the workflow definition.

### Fin Workflow Definition:

 ```js
 {
  "type" : String
  "notifyOnSuccess" : String
 }
 ```
 - `type`: Required.  Only type of workflow, only `gc-workflow` is supported at this time.
 - `notifyOnSuccess`: Optional.  A sub path to notify upon success of the workflow.  Ex: `{"notifyOnSuccess": "/svc:reindex"}` and you call `POST /item/1234/svc:workflow/my-workflow` the service will call `GET /item/1234/svc:reindex` upon success of the workflow.

# Google Cloud Workflows

The fin `gc-workflow` service will initialize your Google Cloud environment then kick off your workflow.

Ex.  Let's say you call `POST /item/1234/svc:workflow/my-workflow`, and the config is `{"tmpGcsBucket":"my-tmp-bucket"}`.  Fin will create a workflowId (say `987-654`) and upload the container, as well as child containers, to `gs://my-tmp-bucket/987-654/` and this path will be passed to the workflow as the `tmpGcsPath` parameter.

Now your workflow as all data it needs to run.  The workflow will run, and when it completes, the `tmpGcsPath` will be deleted.  The fin workflow service DOES NOTHING to the `gcsBucket` and `gcsSubpath` parameters.  It is up to the workflow to store data in the correct location.

## Fin Workflow Definition - gc-workflow

When type is `gc-workflow` the following should be provided in addition to the `Workflow Definition` parameters above.

 - `gcsBucket`: Bucket to store final products.  This is not enforced by the Fin Workflow, but will be passed as a parameter to the workflow.
 - `gcsSubpath`: Optional, but recommended.  subpath to store data in the GCS bucket.  Workflows should store data in GCS at gs://`gcsBucket`/`finPath`/`gcsSubpath`.  This is not enfored by the Fin Workflow, but will be passed as a parameter to the workflow.
 - `tmpGcsBucket`: When a Fin Workflow starts, a uuid `finWorkflowId` will be generated and the container/binary at the specified path will be uploaded to gs://`tmpGcsBucket`/`finWorkflowId`/`containerName`.  This path will be deleted in GCS after the worflow completes.
 - `data`: Additional parameters to send to the GC Workflow.  Note, `{{MY_VAR}}` syntax can be used to insert environment variables.
 
The `data` parameter will automatically have `gcsBucket`, `gcsSubpath`,`tmpGcsBucket`, `tmpGcsPath` and `finWorkflowId` added to it.  Additionally, `finPath` and `finHost` will be added to the run parameters.

## GC Workflow Definitions

All workflow definitions stored in `/fin/workflows/gc/[worfklow-name].yaml` will added to GC on start.

# Usage

## Root Paths

  - `GET /svc:workflow/reload`: Reload the workflow definitions from buckets found in `/fin/workflows/config.json`.  Only updates if workflow found in bucket is newer than the one in PostgreSQL.
  - `GET /svc:workflow/list`: List all workflows

## Container Paths
   
   - `POST /[fin-path]/svc:workflow/[workflow-name]`: Start a workflow
   - `GET /[fin-path]/svc:workflow`: Get all workflows run on path
   - `GET /[fin-path]/svc:workflow/[workflow-id]`: Get a specific workflow run on path

# Workflow Headers

After a workflow is successfully completed, an additional link header will be added to the response.  The link header will be of the form:

```http
Link: <[fin-path]/svc:workflow/[workflow-id]>; rel="workflow"; type="[workflow-name]"
```

This header is often used in data transforms, as they can use the workflow name to determine additional products that have been generated for the container.