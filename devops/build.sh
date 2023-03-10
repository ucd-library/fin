#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..
source ./devops/config.sh

echo "Starting docker build "

if [[ -z "$SHORT_SHA" ]]; then
  FIN_SERVER_REPO_HASH=$(git -C . log -1 --pretty=%h)
else
  FIN_SERVER_REPO_HASH=$SHORT_SHA
fi

# Core Server - fcrepo
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $FCREPO_IMAGE_NAME:$APP_TAG \
  --cache-from $FCREPO_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/fcrepo

# Core Server - postgres
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $POSTGRES_IMAGE_NAME:$APP_TAG \
  --cache-from $POSTGRES_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/postgres

# Core Server - server
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $SERVER_IMAGE_NAME:$APP_TAG \
  --cache-from $SERVER_IMAGE_NAME:$DOCKER_CACHE_TAG \
  -f services/fin/Dockerfile \
  .

# Core Server - elastic search
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG \
  --cache-from $ELASTIC_SEARCH_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/elastic-search

# Core - Init services
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $INIT_IMAGE_NAME:$APP_TAG \
  --cache-from $INIT_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/init