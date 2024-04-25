#! /bin/bash

set -e

wait-for-it -t 0 fcrepo:8080
wait-for-it -t 0 elasticsearch:9200

npm run postgres

TOKEN=$(LOG_LEVEL=error node /service/getToken.js)

FCREPO_HOST=http://gateway:3000 \
FCREPO_JWT=$TOKEN \
  fin io import \
  --import-from-root \
  --fcrepo-path-type=subpath \
  /etc/ucdlib-service-init/fcrepo