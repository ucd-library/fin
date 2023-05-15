#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR

rm -rf dist
mkdir dist

cp -r public/img dist/
# cp -r public/fonts dist/
cp -R -L public/loader dist/

cp public/index.html dist/

webpack --config webpack-dist.config.js