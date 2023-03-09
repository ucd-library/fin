# Init Service

The default fin `init` microservice is based on the `gcr.io/ucdlib-pubreg/init-services` image (https://github.com/ucd-library/ucdlib-service-init).  The base fin `init` service is responsable for initializing the fin PostgreSQL tables.  However it is a best practice to extend this image to add your applications ldp base state as well.

This documentation will take you through how to extend the `init` service to add your application's ldp base state including root containers for models as well as fin config and fin services.

## Setup

Dockerfile

```Dockerfile
ARG INIT_BASE
ARG FIN_SERVER_IMAGE
FROM ${FIN_SERVER_IMAGE} as fin-server
FROM ${INIT_BASE}

COPY --from=fin-server /fin/api /fin-api
RUN cd /fin-api && npm link

RUN apt-get update && apt-get install -y wait-for-it

COPY fcrepo /etc/ucdlib-service-init/fcrepo
COPY docker-run.sh /


CMD /docker-run.sh
```

Where docker run.sh is:

```bash
#! /bin/bash

npm run postgres

wait-for-it -t 0 fcrepo:8080

FCREPO_SUPERUSER=true \
  FCREPO_DIRECT_ACCESS=true \
  FCREPO_HOST=http://fcrepo:8080 \
  fin io import \
  --import-from-root \
  --fcrepo-path-type=subpath \
  /etc/ucdlib-service-init/fcrepo
```

And your build command is something similar to:

```bash
docker build \
  -t gcr.io/ucdlib-pubreg/dams-init \
  --build-arg INIT_BASE=gcr.io/ucdlib-pubreg/fin-init \
  --build-arg FIN_SERVER_IMAGE=gcr.io/ucdlib-pubreg/fin-base-service \
  .
```


This setup assumes you have a local directory called fcrepo.  Inside the directory should be your `fin io` directory structure you would like reflected into fcrepo.

It is recommended you place all of your fin services in `/service` and you MUST put your fin config in `/fin`.  See specific service documentation for more details about how to setup your fin services.
