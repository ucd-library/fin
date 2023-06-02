# Init Service

The default fin `init` microservice is based on the `gcr.io/ucdlib-pubreg/init-services` image (https://github.com/ucd-library/ucdlib-service-init).  The base fin `init` service is responsable for initializing the fin PostgreSQL tables and Fcrepo /fin and /service paths with default fin services.  However it is a best practice to extend this image to add your applications ldp base state as well.

This documentation will take you through how to extend the `init` service to add your application's ldp base state including root containers for models as well as fin config and fin services.

## Setup

Dockerfile

```Dockerfile
ARG FIN_INIT
FROM ${FIN_INIT}

COPY fcrepo /etc/ucdlib-service-init/fcrepo
```

And your build command is something similar to:

```bash
docker build \
  -t gcr.io/ucdlib-pubreg/dams-init \
  --build-arg FIN_INIT=gcr.io/ucdlib-pubreg/fin-init \
  .
```

This setup assumes you have a local directory called fcrepo.  Inside the directory should be your `fin io` directory structure you would like reflected into fcrepo.

It is recommended you place all of your fin services in `/service` and you MUST put your fin config in `/fin`.  See specific service documentation for more details about how to setup your fin services.
