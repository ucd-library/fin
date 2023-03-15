#! /bin/bash

######### MAIN CONFIG ##########
# Setup your application deployment here
################################

# Grab build number is mounted in CI system
if [[ -f /config/.buildenv ]]; then
  source /config/.buildenv
else
  BUILD_NUM=-1
fi

if [[ -z "$BRANCH_NAME" ]]; then
  FIN_BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
else
  FIN_BRANCH_NAME=$BRANCH_NAME
fi

if [[ -z "$TAG_NAME" ]]; then
  FIN_TAG_NAME=$(git describe --tags --abbrev=0)
else
  FIN_TAG_NAME=$TAG_NAME
fi

if [[ "$FIN_BRANCH_NAME" == "main" ]]; then
  APP_TAG=$FIN_TAG_NAME
else
  APP_TAG=$FIN_BRANCH_NAME
fi

# Main version number we are tagging the app with. Always update
# this when you cut a new version of the app!
APP_VERSION=${APP_TAG}.${BUILD_NUM}

#### End main config ####


# Repositories
GITHUB_ORG_URL=https://github.com/ucd-library

## Core Server
FIN_SERVER_REPO_NAME=fin
FIN_SERVER_REPO_URL=$GITHUB_ORG_URL/$FIN_SERVER_REPO_NAME


##
# Registery
##

if [[ -z $A6T_REG_HOST ]]; then
  A6T_REG_HOST=gcr.io/ucdlib-pubreg

  # set local-dev tags used by 
  # local development docker-compose file
  if [[ $LOCAL_DEV == 'true' ]]; then
    A6T_REG_HOST=localhost/local-dev
  fi
fi

DOCKER_CACHE_TAG=$FIN_BRANCH_NAME

# Docker Images
FCREPO_IMAGE_NAME=$A6T_REG_HOST/fin-fcrepo
POSTGRES_IMAGE_NAME=$A6T_REG_HOST/fin-postgres
SERVER_IMAGE_NAME=$A6T_REG_HOST/fin-base-service
ELASTIC_SEARCH_IMAGE_NAME=$A6T_REG_HOST/fin-elastic-search
INIT_IMAGE_NAME=$A6T_REG_HOST/fin-init

ALL_DOCKER_BUILD_IMAGES=( \
 $FCREPO_IMAGE_NAME $POSTGRES_IMAGE_NAME $ELASTIC_SEARCH_IMAGE_NAME \
 $SERVER_IMAGE_NAME $INIT_IMAGE_NAME 
)

# Google Cloud
GC_PROJECT_ID=digital-ucdavis-edu