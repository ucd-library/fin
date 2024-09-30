#! /bin/bash

set -e

PG_USER=${PG_USER:-postgres}
PG_PASSWORD=${PG_PASSWORD:-postgres}
PG_HOST=${PG_HOST:-postgres}
PG_DATABASE=${PG_DATABASE:-fcrepo} 
PG_TABLE_CHECK=${PG_TABLE_CHECK:-containment}

wait-for-it -t 0 fcrepo:8080
wait-for-it -t 0 elasticsearch:9200
wait-for-it -t 0 postgres:5432

function table_exists() {
  TABLE_EXISTS=$(psql -h $PG_HOST -U $PG_USER -d $PG_DATABASE -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$1');")
  echo $TABLE_EXISTS
}

until [[ $(table_exists $PG_TABLE_CHECK) == "t" ]];
do
  echo "Waiting for $PG_TABLE_CHECK table to be created..."
  sleep 2
done
echo "$PG_TABLE_CHECK table exists"

npm run postgres

TOKEN=$(LOG_LEVEL=error node /service/getToken.js)

FCREPO_HOST=http://gateway:3000 \
FCREPO_JWT=$TOKEN \
  fin io import \
  --import-from-root \
  --fcrepo-path-type=subpath \
  /etc/ucdlib-service-init/fcrepo