#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..
source ./devops/config.sh

docker push $FCREPO_IMAGE_NAME:$APP_TAG

docker push $POSTGRES_IMAGE_NAME:$APP_TAG

docker push $LB_IMAGE_NAME:$APP_TAG

docker push $SERVER_IMAGE_NAME:$APP_TAG

docker push $ELASTIC_SEARCH_IMAGE_NAME:$APP_TAG

docker push $INIT_IMAGE_NAME:$APP_TAG

docker push $PGREST_IMAGE_NAME:$APP_TAG

docker push $RABBITMQ_IMAGE_NAME:$APP_TAG

for image in "${ALL_DOCKER_BUILD_IMAGES[@]}"; do
  docker push $image:$DOCKER_CACHE_TAG || true
done
