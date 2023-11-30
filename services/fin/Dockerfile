FROM node:18-bullseye


ENV FIN_SERVICE_ROOT=/fin/services
ENV FIN_API_ROOT=/fin/api
ENV FIN_CONFIG_ROOT=/etc/fin
# Build docker build context path should be the root of this repository
ARG FIN_REPO_SERVICE_ROOT=services/fin
ARG FIN_REPO_API_ROOT=fin-api

RUN apt-get update
RUN apt-get install -y git jq zip unzip vim apt-transport-https ca-certificates gnupg dnsutils
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] http://packages.cloud.google.com/apt cloud-sdk main" | \
  tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
  apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - && apt-get update -y && apt-get install google-cloud-cli -y

RUN apt-get clean

RUN mkdir -p $FIN_SERVICE_ROOT
RUN mkdir -p $FIN_API_ROOT
RUN mkdir -p $FIN_CONFIG_ROOT

# Node API package
WORKDIR ${FIN_API_ROOT}
COPY ${FIN_REPO_API_ROOT}/package.json .
COPY ${FIN_REPO_API_ROOT}/package-lock.json .
RUN npm ci && npm link
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
COPY ${FIN_REPO_SERVICE_ROOT}/gateway gateway
COPY ${FIN_REPO_SERVICE_ROOT}/gcs gcs
COPY ${FIN_REPO_SERVICE_ROOT}/node-utils node-utils
COPY ${FIN_REPO_SERVICE_ROOT}/oidc oidc
COPY ${FIN_REPO_SERVICE_ROOT}/workflow workflow

# Admin UI
COPY ${FIN_REPO_SERVICE_ROOT}/admin-ui admin-ui
RUN cd admin-ui/client/public && npm ci
RUN npm run admin-ui-build
RUN npm run admin-ui-dist

# Leave us in the service root dir
WORKDIR ${FIN_SERVICE_ROOT}

ARG FIN_APP_VERSION
ENV FIN_APP_VERSION=${FIN_APP_VERSION}
ARG FIN_REPO_TAG
ENV FIN_REPO_TAG=${FIN_REPO_TAG}
ARG FIN_BRANCH_NAME
ENV FIN_BRANCH_NAME=${FIN_BRANCH_NAME}
ARG FIN_SERVER_REPO_HASH
ENV FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH}
ARG BUILD_DATETIME
ENV BUILD_DATETIME=${BUILD_DATETIME}

CMD [ "bash", "-c", "tail -f /dev/null"]