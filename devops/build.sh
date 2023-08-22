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
echo    "RabbitMQ : $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo    "PG Rest       : $PGREST_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG"
echo -e "Init          : $INIT_IMAGE_NAME:$APP_TAG and :$DOCKER_CACHE_TAG\n"

# Core Server - fcrepo
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $FCREPO_IMAGE_NAME:$APP_TAG \
  --cache-from $FCREPO_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/fcrepo
docker tag $FCREPO_IMAGE_NAME:$APP_TAG $FCREPO_IMAGE_NAME:$DOCKER_CACHE_TAG

# Core Server - postgres
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $POSTGRES_IMAGE_NAME:$APP_TAG \
  --cache-from $POSTGRES_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/postgres
docker tag $POSTGRES_IMAGE_NAME:$APP_TAG $POSTGRES_IMAGE_NAME:$DOCKER_CACHE_TAG

# Core Server - apache lb
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $LB_IMAGE_NAME:$APP_TAG \
  --cache-from $LB_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/load-balancer
docker tag $LB_IMAGE_NAME:$APP_TAG $LB_IMAGE_NAME:$DOCKER_CACHE_TAG

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
docker tag $SERVER_IMAGE_NAME:$APP_TAG $SERVER_IMAGE_NAME:$DOCKER_CACHE_TAG

# Core Server - elastic search
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG \
  --cache-from $ELASTIC_SEARCH_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/elastic-search
docker tag $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG $ELASTIC_SEARCH_IMAGE_NAME:$DOCKER_CACHE_TAG

# Core Server - elastic search
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $RABBITMQ_IMAGE_NAME:$APP_TAG \
  --cache-from $RABBITMQ_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/rabbitmq
docker tag $RABBITMQ_IMAGE_NAME:$APP_TAG $RABBITMQ_IMAGE_NAME:$DOCKER_CACHE_TAG

# Core - Init services
docker build \
  --build-arg FIN_SERVER_IMAGE=${SERVER_IMAGE_NAME}:${APP_TAG} \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $INIT_IMAGE_NAME:$APP_TAG \
  --cache-from $INIT_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/init
docker tag $INIT_IMAGE_NAME:$APP_TAG $INIT_IMAGE_NAME:$DOCKER_CACHE_TAG

# Core - PG REST
docker build \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  -t $PGREST_IMAGE_NAME:$APP_TAG \
  --cache-from $PGREST_IMAGE_NAME:$DOCKER_CACHE_TAG \
  services/pg-rest
docker tag $PGREST_IMAGE_NAME:$APP_TAG $PGREST_IMAGE_NAME:$DOCKER_CACHE_TAG