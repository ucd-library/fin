#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..
source config.sh

echo "Starting docker build "
FIN_SERVER_REPO_HASH=$(git -C $REPOSITORY_DIR/$FIN_SERVER_REPO_NAME log -1 --pretty=%h)

# Core Server - fcrepo
docker build \
  --build-arg FIN_REPO_TAG=${FIN_REPO_TAG} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $FCREPO_IMAGE_NAME:$APP_VERSION \
  --cache-from $FCREPO_IMAGE_NAME:$DOCKER_CACHE_TAG \
  $REPOSITORY_DIR/$FIN_SERVER_REPO_NAME/services/fcrepo

# Core Server - postgres
docker build \
  --build-arg FIN_REPO_TAG=${FIN_REPO_TAG} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $POSTGRES_IMAGE_NAME:$APP_VERSION \
  --cache-from $POSTGRES_IMAGE_NAME:$DOCKER_CACHE_TAG \
  $REPOSITORY_DIR/$FIN_SERVER_REPO_NAME/services/postgres

# Core Server - server
docker build \
  --build-arg FIN_REPO_TAG=${FIN_REPO_TAG} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $SERVER_IMAGE_NAME:$APP_VERSION \
  --cache-from $SERVER_IMAGE_NAME:$DOCKER_CACHE_TAG \
  -f $REPOSITORY_DIR/$FIN_SERVER_REPO_NAME/services/fin/Dockerfile \
  $REPOSITORY_DIR/$FIN_SERVER_REPO_NAME

# Core Server - elastic search
docker build \
  --build-arg FIN_REPO_TAG=${FIN_REPO_TAG} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $ELASTIC_SEARCH_IMAGE_NAME:$APP_VERSION \
  --cache-from $ELASTIC_SEARCH_IMAGE_NAME:$DOCKER_CACHE_TAG \
  $REPOSITORY_DIR/$FIN_SERVER_REPO_NAME/services/elastic-search

# Core - Init services
docker build \
  -t $INIT_IMAGE_NAME:$APP_VERSION \
  --cache-from $INIT_IMAGE_NAME:$DOCKER_CACHE_TAG \
  $REPOSITORY_DIR/$FIN_SERVER_REPO_NAME/services/init