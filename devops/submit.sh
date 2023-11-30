#! /bin/bash

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..

source ./devops/config.sh

gcloud config set project $GC_PROJECT_ID

echo "Submitting build to Google Cloud..."
gcloud builds submit \
  --config ./devops/cloudbuild.yaml \
  --region us-central1 \
  --substitutions=REPO_NAME=fin,TAG_NAME=$(git tag --points-at HEAD),BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD),SHORT_SHA=$(git log -1 --pretty=%h) \
  .