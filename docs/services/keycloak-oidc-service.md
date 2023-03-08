# OIDC via Keycloak Authentication Service

This service provides authentication via the `oidc` service.  This service will interact with Keycloak to authenticate users and provide a JWT token for use with other services using the OIDC protocol.

## Setup

Put the following in: `/service/keycloak`

```json
{
  "@id": "",
  "@type": [
    "http://digital.ucdavis.edu/schema#Service",
    "http://digital.ucdavis.edu/schema#AuthenticationService"
  ],
  "url": "http://oidc:3000",
  "description": "Keycloak oidc authentication service",
  "identifier": "keycloak-oidc",
  "title": "keycloak-oidc",
  "@context": {
    "title": {
      "@id": "http://purl.org/dc/elements/1.1/title"
    },
    "identifier": {
      "@id": "http://purl.org/dc/elements/1.1/identifier"
    },
    "urlTemplate": {
      "@id": "http://digital.ucdavis.edu/schema#urlTemplate"
    },
    "description": {
      "@id": "http://purl.org/dc/elements/1.1/description"
    }
  }
}
```

## Usage

The AuthenticationService uses the standard fin authentication urls.  Using the setup above:

  - `GET /auth/keycloak-oidc/login` will redirect to the Keycloak login page.
  - `GET /auth/logout` will logout the user
  - `POST /auth/keycloak-oidc/service-account/token` with a JSON body `{"username":"", "secret":""}` will return a JWT access token for the service account.


## A Note on Service Accounts

Service Accounts are just user accounts in Keycloak. To create a service account, create a user in Keycloak and give it the `service-account` role.  As well as any other roles required.  It is a best practice to use `-service-account` as the suffix of the username.

After you create the account, go to `credentials` and set a password.  The password should be a 512 character string of random characters.  You can use the following command to generate a password:

```bash
openssl rand -base64 512 | tr -d '\n'
```

Make sure you do not mark the password as temporary.