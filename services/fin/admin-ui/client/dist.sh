#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR

rm -rf dist
mkdir dist


cp -r public/img dist/
# cp -r public/fonts dist/
cp -R -L public/loader dist/
cp -R -L public/css dist/

cp public/node_modules/\@ucd-lib/theme-sass/style-ucdlib.css dist/css/style-ucdlib.css
cp public/node_modules/\@ucd-lib/theme-sass/css-properties.css dist/css/css-properties.css

cp public/index.html dist/

webpack --config webpack-dist.config.js