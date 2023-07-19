import keycloak from '/fin/services/node-utils/lib/keycloak.js';

(async function() {
	console.log(await keycloak.getServiceAccountToken());
  process.exit();
})();