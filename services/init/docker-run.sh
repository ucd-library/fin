#! /bin/bash

wait-for-it -t 0 fcrepo:8080
wait-for-it -t 0 elasticsearch:9200

npm run postgres

FCREPO_SUPERUSER=true \
  FCREPO_DIRECT_ACCESS=true \
  FCREPO_HOST=http://fcrepo:8080 \
  fin io import \
  --import-from-root \
  --fcrepo-path-type=subpath \
  /etc/ucdlib-service-init/fcrepo