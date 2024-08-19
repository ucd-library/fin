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

DOCKER="docker --debug"
if [[ ! -z $BUILD_ARCHITECTURE ]]; then
  DOCKER="$DOCKER --context $BUILD_ARCHITECTURE"
fi

export DOCKER_BUILDKIT=1

DOCKER_BUILD="$DOCKER buildx build --output=type=docker --cache-to=type=inline,mode=max "
if [[ $LOCAL_DEV != 'true' ]]; then
  DOCKER_BUILD="$DOCKER_BUILD --pull "
else
  DOCKER_BUILD="$DOCKER_BUILD --load"
fi

DOCKER_PUSH="$DOCKER push "

function get_tags() {
  CACHE_IMAGE=$1:$FIN_BRANCH_NAME

  if [[ -z $BUILD_ARCHITECTURE ]]; then
    IMAGE_TAG_FLAGS="-t $1:$FIN_BRANCH_NAME"
    if [[ ! -z "$FIN_TAG_NAME" ]]; then
      IMAGE_TAG_FLAGS="$IMAGE_TAG_FLAGS -t $1:$FIN_TAG_NAME"
    fi
    return
  fi

  CACHE_IMAGE=$1:$FIN_BRANCH_NAME-$BUILD_ARCHITECTURE
  IMAGE_TAG_FLAGS="-t $1:$FIN_BRANCH_NAME-$BUILD_ARCHITECTURE"
  if [[ ! -z "$FIN_TAG_NAME" ]]; then
    IMAGE_TAG_FLAGS="$IMAGE_TAG_FLAGS -t $1:$FIN_TAG_NAME-$BUILD_ARCHITECTURE"
  fi
}

function push() {
  if [[ $LOCAL_DEV == 'true' ]]; then
    echo "Skipping push for local dev"
    return
  fi

  if [[ -z $BUILD_ARCHITECTURE ]]; then
    echo "No build architecture set, skipping push"
    return
  fi

  $DOCKER_PUSH $1:$FIN_BRANCH_NAME-$BUILD_ARCHITECTURE
  if [[ ! -z "$FIN_TAG_NAME" ]]; then
    $DOCKER_PUSH $1:$FIN_TAG_NAME-$BUILD_ARCHITECTURE
  fi
}

# for google cloud multi-arch builds
if [[ $LOCAL_DEV == 'true' ]]; then
  echo "Skipping context creation for local dev"
  # DOCKER_BUILD="$DOCKER_BUILD --output=type=docker"
elif [[ $BUILD_ARCHITECTURE == 'amd' ]]; then
  docker context create amd --docker "host=unix:///var/run/docker.sock" || true
elif [[ $BUILD_ARCHITECTURE == 'arm' ]]; then
  eval `ssh-agent`
  ssh-add /root/.ssh/ci-bot
  docker context create arm --docker "host=ssh://ci-bot@$ARM64_MACHINE_IP" || true
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
  services/fcrepo
push $FCREPO_IMAGE_NAME

# Core Server - postgres
get_tags $POSTGRES_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
   $(echo $IMAGE_TAG_FLAGS) \
  services/postgres
push $POSTGRES_IMAGE_NAME

# Core Server - apache lb
get_tags $LB_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  services/load-balancer
push $LB_IMAGE_NAME

# Core Server - server
get_tags $SERVER_IMAGE_NAME
BUILD_FIN_SERVER_IMAGE=$CACHE_IMAGE
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  -f services/fin/Dockerfile \
  .
push $SERVER_IMAGE_NAME

# Core Server - elastic search
get_tags $ELASTIC_SEARCH_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  services/elastic-search
push $ELASTIC_SEARCH_IMAGE_NAME

# Core Server - rabbitmq
get_tags $RABBITMQ_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  services/rabbitmq
push $RABBITMQ_IMAGE_NAME

# Core - Init services
get_tags $INIT_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_SERVER_IMAGE=${BUILD_FIN_SERVER_IMAGE} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  services/init
push $INIT_IMAGE_NAME

# Core - PG REST
get_tags $PGREST_IMAGE_NAME
$DOCKER_BUILD \
  --build-arg FIN_APP_VERSION=${APP_VERSION} \
  --build-arg FIN_REPO_TAG=${FIN_TAG_NAME} \
  --build-arg FIN_BRANCH_NAME=${FIN_BRANCH_NAME} \
  --build-arg FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH} \
  --build-arg BUILD_DATETIME=${BUILD_DATETIME} \
  $(echo $IMAGE_TAG_FLAGS) \
  services/pg-rest
push $PGREST_IMAGE_NAME