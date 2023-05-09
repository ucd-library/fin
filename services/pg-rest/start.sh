#! /bin/bash

set -e

# Set standard environment variables
PG_HOST=${PG_HOST:-"postgres"}
PG_PORT=${PG_PORT:-"5432"}
PG_USER=${PG_USER:-"postgres"}
PG_PASSWORD=${PG_PASSWORD:-""}
PG_DATABASE=${PG_DATABASE:-"fcrepo"}

if [[ $PG_PASSWORD != "" ]]; then
    PG_PASSWORD=":${PG_PASSWORD}"
fi

# https://postgrest.org/en/stable/auth.html#asymmetric-keys
if [[ ! -z $JWT_JWKS_URI ]]; then
  export PGRST_JWT_SECRET=$(curl -s $JWT_JWKS_URI)
elif [[ ! -z $JWT_SECRET ]]; then
  export PGRST_JWT_SECRET=$JWT_SECRET
fi

export PGRST_DB_URI="postgres://${PG_USER}${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}"

export PGRST_SERVER_PORT=${PGRST_SERVER_PORT:-"3000"}
export PGRST_LOG_LEVEL=${PGRST_LOG_LEVEL:-"info"}
export PGRST_DB_ANON_ROLE="admin_rest_api"
export PGRST_DB_SCHEMAS="restapi"

/bin/postgrest