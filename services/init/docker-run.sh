#! /bin/bash

wait-for-it -t 0 fcrepo:8080
wait-for-it -t 0 elasticsearch:9200

npm run postgres