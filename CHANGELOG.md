# 2.2.2

  - fin io no longer looks at `@id` for ldp container id lookup
  - Admin UI displays changes for (some) values, this will by built out more
  - Data validation entries are now deleted if not database item exists
  - dbsync.update_status entries for update_types `Delete` and `Purge` are now deleted removed after one week.

# 2.2.1

  - fixes for fin io `@base:` handling
  - fix for dbsync reindex endpoint
  - fix for stomp disconnection
  - adding force binary update flag to fin io
  - fix for acl imports via fin io (@base: required for pointing at container)

# 2.2.0

  - `fin io` indirect reference restructure
 
# 2.1.x

  - fin io import rewrite.
  - gcssync fixes

# 2.0.4

 - Fix for gcssync when root path is a `gcs` 'directory' (i.e. a real file)
 - GCS sync now creates sub paths if they don't exist ensure that they can by modified later on

# 2.0.3

 - Disabling autoversioning of ocfl.  `fcrepo.autoversioning.enabled=false`
 - Fix for exposing pg uuid to public schema
 - update for data model fcrepo access when no transform provided
 - Start of new `/fin/rest` endpoint for; direct access to OCFL via fs and pg, always returns expanded JSONLD even for binaries, so no need for `/fcr:metadata`.

# 2.0.2
 
 - Fix For `fin io` command where `iodir` was just checking the graph context

# 2.0.1

 - First versioned image release of Fin v2
