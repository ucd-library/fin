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
BUILD_DATETIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

export DOCKER_BUILDKIT=1
DOCKER_BUILD="docker buildx build"

function gcloud_build() {
  ARGS=$*

  CMD="docker buildx build --platform linux/amd64,linux/arm64 --pull $ARGS"
  echo "Running docker build: $CMD"
  $CMD

  echo "Pushing images to gcr.io"
  CMD="$CMD --push --cache-to=type=inline"
  $CMD
}

function get_tags() {
  IMAGE_TAG_FLAGS="-t $1:$FIN_BRANCH_NAME"
  if [[ ! -z "$FIN_TAG_NAME" ]]; then
    IMAGE_TAG_FLAGS="$IMAGE_TAG_FLAGS -t $1:$FIN_TAG_NAME"
  fi
}

# for google cloud multi-arch builds
if [[ $LOCAL_DEV == 'true' ]]; then
  DOCKER_BUILD="$DOCKER_BUILD --output=type=docker"
else
  echo "Setting up docker buildx using arm machine: $ARM64_MACHINE_IP"
  docker context create amd_node --docker "host=unix:///var/run/docker.sock"
  docker context create arm_node --docker "host=ssh://ci-bot@$ARM64_MACHINE_IP"

  docker buildx create --use --name ucd-lib-builder --platform linux/amd64 amd_node
  docker buildx create --append --name ucd-lib-builder --platform linux/arm64 arm_node

  DOCKER_BUILD="gcloud_build"
fi


echo "Fin Repository:"
echo "Branch: $FIN_BRANCH_NAME"
if [[ ! -z "$FIN_TAG_NAME" ]]; then
  echo "Tag: $FIN_TAG_NAME"
  FIN_TAG_LABEL=", $FIN_TAG_NAME"
fi
echo "SHA: $FIN_SERVER_REPO_HASH"

echo -e "\nBuilding images:"
echo    "Fcrepo        : $FCREPO_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL"
echo    "Postgres      : $POSTGRES_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL"
echo    "Apache LB     : $LB_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL"
echo    "Base Service  : $SERVER_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL"
echo    "ElasticSearch : $ELASTIC_SEARCH_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL"
echo    "RabbitMQ      : $RABBITMQ_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL"
echo    "PG Rest       : $PGREST_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL"
echo -e "Init          : $INIT_IMAGE_NAME:$FIN_BRANCH_NAME$FIN_TAG_LABEL\n"

echo -e "Docker build command: $DOCKER_BUILD\n"

# Core Server - fcrepo
get_tags $FCREPO_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $FCREPO_IMAGE_NAME:$FIN_BRANCH_NAME \
  services/fcrepo

# Core Server - postgres
get_tags $POSTGRES_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
   $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $POSTGRES_IMAGE_NAME:$FIN_BRANCH_NAME \
  services/postgres

# Core Server - apache lb
get_tags $LB_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $LB_IMAGE_NAME:$FIN_BRANCH_NAME \
  services/load-balancer

# Core Server - server
get_tags $SERVER_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $SERVER_IMAGE_NAME:$FIN_BRANCH_NAME \
  -f services/fin/Dockerfile \
  .

# Core Server - elastic search
get_tags $ELASTIC_SEARCH_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $ELASTIC_SEARCH_IMAGE_NAME:$FIN_BRANCH_NAME \
  services/elastic-search

# Core Server - rabbitmq
get_tags $RABBITMQ_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $RABBITMQ_IMAGE_NAME:$FIN_BRANCH_NAME \
  services/rabbitmq

# Core - Init services
get_tags $INIT_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_SERVER_IMAGE=${SERVER_IMAGE_NAME}:${APP_TAG} \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $INIT_IMAGE_NAME:$FIN_BRANCH_NAME \
  services/init

# Core - PG REST
get_tags $PGREST_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  --cache-from $PGREST_IMAGE_NAME:$BUILD_DATETIME \
  services/pg-rest