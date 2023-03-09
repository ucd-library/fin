#! /bin/bash

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..

gcloud config set project digital-ucdavis-edu

echo "Submitting build to Google Cloud..."
gcloud builds submit \
  --config ./cloudbuild.yaml \
  --substitutions=REPO_NAME=fin-ucd-lib-deployment,TAG_NAME=$(git describe --tags --abbrev=0),BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD),SHORT_SHA=$(git log -1 --pretty=%h) \
  ..