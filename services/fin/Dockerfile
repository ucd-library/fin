FROM node:20-bullseye


ENV FIN_SERVICE_ROOT=/fin/services
ENV FIN_API_ROOT=/fin/api
ENV FIN_CONFIG_ROOT=/etc/fin
# Build docker build context path should be the root of this repository
ARG FIN_REPO_SERVICE_ROOT=services/fin
ARG FIN_REPO_API_ROOT=fin-api

ENV DEBIAN_FRONTEND=noninteractive

COPY ${FIN_REPO_SERVICE_ROOT}/install-depends.sh /install-depends.sh
RUN chmod +x /install-depends.sh && \
  /install-depends.sh && \
  rm /install-depends.sh

RUN mkdir -p $FIN_SERVICE_ROOT
RUN mkdir -p $FIN_API_ROOT
RUN mkdir -p $FIN_CONFIG_ROOT

# Node API package
WORKDIR ${FIN_API_ROOT}
COPY ${FIN_REPO_API_ROOT}/package.json .
COPY ${FIN_REPO_API_ROOT}/package-lock.json .
RUN npm install && npm link
# The npm link doesn't always properly set this :/
RUN ln -s /fin/api/cli/bin/fin.js /usr/local/bin/fin

# Main service package
WORKDIR ${FIN_SERVICE_ROOT}
COPY ${FIN_REPO_SERVICE_ROOT}/package.json .
COPY ${FIN_REPO_SERVICE_ROOT}/package-lock.json .
RUN npm ci  && \
  npm link && \
  npm link @ucd-lib/fin-service-utils @ucd-lib/fin-api

# API Code
WORKDIR ${FIN_API_ROOT}
COPY ${FIN_REPO_API_ROOT}/index.js .
COPY ${FIN_REPO_API_ROOT}/lib lib
COPY ${FIN_REPO_API_ROOT}/cli cli

# Services Code
WORKDIR ${FIN_SERVICE_ROOT}
COPY ${FIN_REPO_SERVICE_ROOT}/api api
COPY ${FIN_REPO_SERVICE_ROOT}/dbsync dbsync
COPY ${FIN_REPO_SERVICE_ROOT}/es-index-management es-index-management
COPY ${FIN_REPO_SERVICE_ROOT}/fin-ac fin-ac
COPY ${FIN_REPO_SERVICE_ROOT}/fin-cache fin-cache
COPY ${FIN_REPO_SERVICE_ROOT}/gateway gateway
COPY ${FIN_REPO_SERVICE_ROOT}/monitoring monitoring
COPY ${FIN_REPO_SERVICE_ROOT}/gcs gcs
COPY ${FIN_REPO_SERVICE_ROOT}/node-utils node-utils
COPY ${FIN_REPO_SERVICE_ROOT}/oidc oidc
COPY ${FIN_REPO_SERVICE_ROOT}/workflow workflow
COPY ${FIN_REPO_SERVICE_ROOT}/uber uber

# Service Definitions
RUN mkdir -p /etc/fin
COPY ${FIN_REPO_SERVICE_ROOT}/service-defs /etc/fin/services

# Admin UI
COPY ${FIN_REPO_SERVICE_ROOT}/admin-ui admin-ui
RUN cd admin-ui/client/public && npm install
RUN npm run admin-ui-build
RUN npm run admin-ui-dist

# Leave us in the service root dir
WORKDIR ${FIN_SERVICE_ROOT}


CMD [ "bash", "-c", "tail -f /dev/null"]