ARG INIT_BASE=gcr.io/ucdlib-pubreg/init-services:main
ARG FIN_SERVER_IMAGE
FROM ${FIN_SERVER_IMAGE} as fin-server
FROM ${INIT_BASE}

COPY --from=fin-server /fin/api /fin-api
RUN cd /fin-api && npm link

COPY --from=fin-server /fin/services /fin/services
RUN cd /fin/services && npm link @ucd-lib/fin-api
RUN cd /fin/services && npm link 

RUN apt-get update && apt-get install -y wait-for-it

RUN mkdir -p /etc/ucdlib-service-init
COPY postgres /etc/ucdlib-service-init/postgres
COPY fcrepo /etc/ucdlib-service-init/fcrepo
COPY getToken.js /service/getToken.js
COPY docker-run.sh /

ENV PG_DATABASE=fcrepo

ARG FIN_APP_VERSION
ENV FIN_APP_VERSION=${FIN_APP_VERSION}
ARG FIN_REPO_TAG
ENV FIN_REPO_TAG=${FIN_REPO_TAG}
ARG FIN_BRANCH_NAME
ENV FIN_BRANCH_NAME=${FIN_BRANCH_NAME}
ARG FIN_SERVER_REPO_HASH
ENV FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH}

CMD /docker-run.sh