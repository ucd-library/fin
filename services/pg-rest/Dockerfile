FROM debian:bullseye

# copy PostgREST over
COPY --from=postgrest/postgrest /bin/postgrest /bin

RUN apt-get update && apt-get install -y curl

COPY start.sh /start.sh

ARG FIN_APP_VERSION
ENV FIN_APP_VERSION=${FIN_APP_VERSION}
ARG FIN_REPO_TAG
ENV FIN_REPO_TAG=${FIN_REPO_TAG}
ARG FIN_BRANCH_NAME
ENV FIN_BRANCH_NAME=${FIN_BRANCH_NAME}
ARG FIN_SERVER_REPO_HASH
ENV FIN_SERVER_REPO_HASH=${FIN_SERVER_REPO_HASH}

CMD ["/start.sh"]