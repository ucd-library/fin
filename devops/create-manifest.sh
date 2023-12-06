#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR

source ./config.sh

function create_manifests() {
  create_manifest $1:$FIN_BRANCH_NAME
  if [[ ! -z "$FIN_TAG_NAME" ]]; then
    create_manifest $1:$FIN_TAG_NAME
  fi
}

function create_manifest() {
  docker manifest create $1 \
    --amend $1-amd \
    --amend $1-arm
  docker manifest push $1
}

create_manifests $FCREPO_IMAGE_NAME
create_manifests $POSTGRES_IMAGE_NAME
create_manifests $LB_IMAGE_NAME
create_manifests $SERVER_IMAGE_NAME
create_manifests $ELASTIC_SEARCH_IMAGE_NAME
create_manifests $RABBITMQ_IMAGE_NAME
create_manifests $INIT_IMAGE_NAME
create_manifests $PGREST_IMAGE_NAME