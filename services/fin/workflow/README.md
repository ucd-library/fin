# Fin Workflow Service

# Config Definition

The workflow definition file should exist at: /fin/workflows/config.json

## Fin Base Workflows Definition:

```js
{
  "defaults" : Object,
  "definitions" : Object
}
```

 - `defaults`: Default configuration variables.  If a workflow does not defined a parameter, the default will be used.
 - `definitions`: Object were the key is the workflow name and the value is an Object containing the workflow definition.

## Fin Workflow Definition:

 ```js
 {
  "type" : String
  "finPathMustExist" : Boolean
 }
 ```
 - `type`: type of workflow, only `gc-workflow` is supported at this time.
 - `finPathMustExist`: should a container or binary exist at the path?  You may have a case where the workflow will create the container(s) at the path, otherwise this should be `true`.


## Fin Workflow Definition - GC Workflow

When type is `gc-workflow` the following should be provided in addition to the `Workflow Definition` parameters above.

 - `gcsBucket`: Bucket to store final products.  This is not enforced by the Fin Workflow, but will be passed as a parameter to the workflow.
 - `gcsSubpath`: subpath to store data in the GCS bucket.  Workflows should store data in GCS at gs://`gcsBucket`/`finPath`/`gcsSubpath`.  This is not enfored by the Fin Workflow, but will be passed as a parameter to the workflow.
 - `tmpGcsBucket`: When a Fin Workflow starts, a uuid `finWorkflowId` will be generated and the container/binary at the specified path will be uploaded to gs://`tmpGcsBucket`/`finWorkflowId`/`containerName`.  This path will be deleted in GCS after the worflow completes.
 - `data`: Additional parameters to send to the GC Workflow.  Note, `{{MY_VAR}}` syntax can be used to insert environment variables.
 
The `data` parameter will automatically have `gcsBucket`, `gcsSubpath`,`tmpGcsBucket` and `finWorkflowId` added to it.  Additionally, `finPath` and `finHost` will be added to the run parameters.

# Fin GC Workflow Definitions

All workflow definitions stored in `/fin/workflows/gc/[worfklow-name].yaml` will added to GC on start.