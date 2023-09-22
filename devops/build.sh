#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..
source ./devops/config.sh

echo -e "Starting docker build: $APP_VERSION\n"

if [[ -z "$SHORT_SHA" ]]; then
  FIN_SERVER_REPO_HASH=$(git -C . log -1 --pretty=%h)
else
  FIN_SERVER_REPO_HASH=$SHORT_SHA
fi

DOCKER_BUILD="docker buildx build"

# for google cloud multi-arch builds
if [[ $LOCAL_DEV == 'true' ]]; then
  DOCKER_BUILD="$DOCKER_BUILD --pull --output=type=docker"
else
  echo "Setting up docker buildx using arm machine: $ARM64_MACHINE_IP"
  docker context create amd_node --docker "host=unix:///var/run/docker.sock"
  docker context create arm_node --docker "host=ssh://ci-bot@$ARM64_MACHINE_IP"

  docker buildx create --use --name ucd-lib-builder --platform linux/amd64 amd_node
  docker buildx create --append --name ucd-lib-builder --platform linux/arm64 arm_node

  DOCKER_BUILD="$DOCKER_BUILD --platform linux/amd64,linux/arm64 --push --pull"
fi


echo "Fin Repository:"
echo "Branch: $FIN_BRANCH_NAME"
echo "Tag: $FIN_TAG_NAME"
echo "SHA: $FIN_SERVER_REPO_HASH"

echo -e "\nBuilding images:"
echo    "Fcrepo        : $FCREPO_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo    "Postgres      : $POSTGRES_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo    "Apache LB     : $LB_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo    "Base Service  : $SERVER_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo    "ElasticSearch : $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo    "RabbitMQ      : $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo    "PG Rest       : $PGREST_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo -e "Init          : $INIT_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG\n"

echo -e "Docker build command: $DOCKER_BUILD\n"

# Core Server - fcrepo
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $FCREPO_IMAGE_NAME:$APP_TAG \
  -t $FCREPO_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $FCREPO_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  services/fcrepo

# Core Server - postgres
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $POSTGRES_IMAGE_NAME:$APP_TAG \
  -t $POSTGRES_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $POSTGRES_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  services/postgres

# Core Server - apache lb
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $LB_IMAGE_NAME:$APP_TAG \
  -t $LB_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $LB_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  services/load-balancer

# Core Server - server
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $SERVER_IMAGE_NAME:$APP_TAG \
  -t $SERVER_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $SERVER_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  -f services/fin/Dockerfile \
  .

# Core Server - elastic search
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG \
  -t $ELASTIC_SEARCH_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $ELASTIC_SEARCH_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  services/elastic-search

# Core Server - rabbitmq
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $RABBITMQ_IMAGE_NAME:$APP_TAG \
  -t $RABBITMQ_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $RABBITMQ_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  services/rabbitmq

# Core - Init services
$DOCKER_BUILD \
  --build-arg FIN_SERVER_IMAGE=${SERVER_IMAGE_NAME}:${APP_TAG} \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $INIT_IMAGE_NAME:$APP_TAG \
  -t $INIT_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $INIT_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  services/init

# Core - PG REST
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $PGREST_IMAGE_NAME:$APP_TAG \
  -t $PGREST_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-from $PGREST_IMAGE_NAME:$DOCKER_CACHE_TAG \
  --cache-to=type=inline \
  services/pg-rest