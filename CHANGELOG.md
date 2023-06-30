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
