#! /bin/bash

set -e
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR

rm -rf public/css
mkdir -p public/css

cp public/node_modules/\@ucd-lib/theme-sass/style-ucdlib.css public/css/style-ucdlib.css
cp public/node_modules/\@ucd-lib/theme-sass/css-properties.css public/css/css-properties.css

webpack --watch