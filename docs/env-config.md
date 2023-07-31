# Fin Configuration 

The following are the standard environmental variables used by Fin and it's core services. Developers, all config properties can be seen here: [config.js](../services/fin/node-utils/config.js) 

  - [Base Config](#base-config)
  - [Authentication](#authentication)
  - [Google Cloud Config](#google-cloud-config)
  - [Postgres Config](#postgres-config)
  - [ElasticSearch Config](#elasticsearch-config)
  - [Redis Config](#redis-config)

# Base Config

## FIN_URL (required)

Default: http://localhost:3000

This should be the root url (domain name) of your Fin service. 

## GCS_BUCKET_ENV

Default: local-dev

Used for accessing Google Cloud Storage data environments.  Example in the GCS config definitions you can
say `dams-client-{{GCS_BUCKET_ENV}}`, which will resolve to `dams-client-local-dev` or `dams-client-prod` depending on the value of `GCS_BUCKET_ENV` and which environment you are running in.

## WORKFLOW_ENV

Default: local-dev

Used for accessing Google Cloud Workflow environments.  Example in the GCS config definitions you can
say `dams-client-{{GCS_BUCKET_ENV}}`, which will resolve to `dams-client-local-dev` or `dams-client-prod` depending on the value of `GCS_BUCKET_ENV` and which environment you are running in.

## CLIENT_ENV

Default: dev

Should be used be your client application.  Normally `prod` serves your production 
build of the client app.  Everything else serves the dev build.  But this is not
implemented by fin, you must implement it in your client app.

## LOG_LEVEL FIN_LOG_LEVEL

Default: info

Used to set the log level for all services.  Either env var will work.

## FIN_MODEL_ROOT

Default: /fin/services/models

Path to the directory where your fin data models are stored.


## FIN_COOKIE_SECRET

Default: changeme

Used to encrypt your cookies

## FIN_COOKIE_MAX_AGE (time in milliseconds)

Default: 7 days

## FIN_ALLOW_ORIGINS

Comma separated list of origins you would like to grant access to FIN.  Requests from these origins will set proper CORS headers in the response as well as handle the browser preflight OPTIONS CORS request.

[Read more](./cors.md)

# Authentication

## JWT_SECRET (required)

Secret used for talking to OIDC provider (keycloak)

## JWT_ISSUER (required)

Issuer used for talking to OIDC provider (keycloak)

## JWT_COOKIE_NAME

Default: fin-jwt

Name of cookie to store JWT token

## JWT_JWKS_URI (required)

URL to the JWKS endpoint of the OIDC provider (keycloak)

## OIDC_CLIENT_ID (required)

Client ID of the OIDC provider client (keycloak)

## OIDC_CLIENT_SECRET (required)

Client secret of the OIDC provider client (keycloak)

## OIDC_BASE_URL (required)

Base URL of the OIDC provider realm (keycloak)

## OIDC_SCOPES

Default: roles openid profile email

Scopes to request in token

## OIDC_FIN_LDP_SERVICE_NAME

Default: keycloak-oidc

Name of the OIDC auth services (so container name in `docker compose` speak) that is used to authenticate against keycloak.

## FIN_SERVICE_ACCOUNT_NAME

Service account name used to authenticate to the OIDC provider (keycloak). For keycloak, this is the username of the service account.

## FIN_SERVICE_ACCOUNT_PASSWORD

Service account password used to authenticate to the OIDC provider (keycloak). For keycloak, this is the password of the service account.  This should be a 512 character string.

```bash
openssl rand -base64 512
```

If you have the above `FIN_SERVICE_ACCOUNT_*` parameters set in your `.env`.  You can test your service account with:

```bash
docker run --rm -i -t --env-file .env --name init gcr.io/ucdlib-pubreg/fin-init:${version} node /service/getToken.js
```

# Google Cloud Config

## GOOGLE_APPLICATION_CREDENTIALS

Default: /etc/fin/service-account.json

Path to the service account json file.  This is used by any service to authenticate to GCS.

## GOOGLE_SERVICE_ACCOUNT_EMAIL

Service account to use for GCS.  If not set, the service account specified in the GOOGLE_APPLICATION_CREDENTIALS file will be used.

## GOOGLE_CLOUD_PROJECT

Google Cloud Project ID.  If not set, the project ID specified in the GOOGLE_APPLICATION_CREDENTIALS file will be used.

## GOOGLE_CLOUD_LOCATION

Default: us-central1

Location of GCS services.

## GOOGLE_PUBSUB_SUBSCRIPTION_NAME

Name to use for pubsub subscriptions.  If not set, the default subscription name will be set to `GCS_BUCKET_ENV`, which defaults to
`local-dev` if not set. 

## GOOGLE_MAX_CONCURRENT_WORKFLOWS

Default: 3

Set the maximum number of concurrent workflows to run.  This is used by the workflow service to limit the number of workflows that can be running at once.  This only applies to workflows of type `gc-workflow`.

# Postgres Config

## PG_HOST

Default: postgres

## PG_PORT

Default: 5432

## PG_USER

Default: postgres

## PG_DATABASE

Default: fcrepo


# ElasticSearch Config

## ES_HOST

Default: elasticsearch

## ES_PORT

Default: 9200

## ELASTIC_USERNAME

Default: elastic

## ELASTIC_PASSWORD

Default: elastic

## ES_LOG_LEVEL

Default: error

# Redis Config

## REDIS_HOST

Default: redis

## REDIS_PORT

Default: 6379

# Fcrepo Config

## FCREPO_HOST

Default: fcrepo

Host name of the `fcrepo` service
