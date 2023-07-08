# Fin IO Import

## Determining the fcrepo path

There are multiple parameters that determine a containers path when importing via
`fin io import`.  
  - the `/fin/io/config.json` file
  - the `--import-from-root` flag
  - the path between the `ArchivalGroup` container and the container being imported.
  - the `--fcrepo-path-type` flag

The following terminology will be used below to describe the path of a container in fcrepo:
  - `rootPath` - the root path of the container in fcrepo, defined by the typeMapper configuration in fcrepo (`/fin/io/config.json`)
  - `subpath` - the path of the file relative to the start location of the import or the `ArchivalGroup`.  Determined by the `--import-from-root` flag
  - the path between the `ArchivalGroup` container and the container being imported, the `ag path`.
  - `id` - the id of the container in fcrepo determined by the `--fcrepo-path-type` flag

So the actual fcrepo path from `fin io import` will be: `[rootPath]/[subpath]/[ag path]/[id]`
  


### Fin IO Config - Type Mappers

Type mappers allow you to define the root fin path for specific container types.  In the example below, all containers of type `http://schema.org/Collection` will be imported to the `/collection` path in fcrepo.  All other containers will be imported to the `/item` path in fcrepo.  If no type mapper is defined, the root fin path will be `/`.

Ex:

```json
{
  "typeMappers" : [{
    "id" : "collection",
    "types" : ["http://schema.org/Collection"],
    "basePath" : "/collection",
  }],
  "default" : {
    "id" : "item",
    "basePath" : "/item"
  }
}
```


### `--import-from-root`

This parameter determines the `sub path` for which the import will be performed.  By default, `fin io import` will ignore all containers until it finds a `ArchivalGroup` container.  It will then import all containers under the `ArchivalGroup` container using `type mapper` (see above) as the `root path` followed by the `sub path` which is the relative path from the `ArchivalGroup` container to the container being imported.  However if the `--import-from-root` flag is set, the `sub path` will be the full path relative to the import start location.

Example: 

In this example, we will have an ArchivalGroup container at `/foo/bar/baz.jsonld.json`

Default behavior:
 - The `sub path` will be empty 
With `--import-from-root`:
 - The `sub path` will be set to `/foo/bar` in fcrepo

Then the container `/foo/bar/baz/another` the `sub path` will be set to:

Default behavior:
 - `/another`
With `--import-from-root`:
  - `/foo/bar/baz`

## Ag Path

The archival group path is simply the relative path between the `ArchivalGroup` container and the container being imported.

### `--fcrepo-path-type`

The `--fcrepo-path-type` flag determines the remaining part of the fcrepo path, known as the `id`. There are two `fcrepo path type` strategies; `id` and `subpath`.

 - `id`: Id will use the following formula to created the final location of the path.
  - is `@id` set?  if so use it.
  - does the container have a `schema:identifier`?  if so:
    - grab the first `schema:identifier` value that starts with `ark:/`
    - otherwise grab the first `schema:identifier` value
  - Use base filename of the file being imported
 - `subpath`: Just use the subpath as the id.  This is the same as the final option of the `id` strategy, but without the `@id` or `schema:identifier` checks.

`id` is the default strategy.
