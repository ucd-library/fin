const router = require('express').Router();
const {logger, models} = require('@ucd-lib/fin-service-utils');
const swaggerJSDoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'FIN API',
    version: '1.0.0',
    description:
      'This is the Swagger documentation for FIN.',
    license: {
      name: 'Licensed Under MIT',
      url: 'https://spdx.org/licenses/MIT.html',
    },
    contact: {
      name: 'Online Strategy - UC Davis Library',
      url: 'https://library.ucdavis.edu/online-strategy/',
    },
  },
  paths: {}
};

(async function() {
  let apis = [];
  let names = await models.names();
  for( let name of names ) {
    let {api, swagger} = await models.get(name);
    if( !api ) continue;

    try {
      if( swagger && swagger.paths ) {
        if( !Array.isArray(swagger.paths) ) {
          swagger.paths = Object.entries(swagger.paths).map(([key, value]) => ({ path : key, docs : value }));
        }
        swagger.paths.forEach(doc => {
          swaggerDefinition.paths[`/api/${doc.path.replace(/\/?api\/?/g, '')}`] = doc.docs;
        });

        if( swagger.components?.schemas ) {
          swaggerDefinition.components = swagger.components;
        }
      }
      apis.push('api/'+name); 
    } catch (e) {
      logger.error('Error loading swagger for '+name, e);
    }

    logger.info(`Registering api routes for ${name} at /api/${name}`);
    router.use('/'+name, api);
  }

  apis.push('api/controllers/*.js');
  
  const options = {
    swaggerDefinition,
    apis,
  };
  
  const swaggerSpec = swaggerJSDoc(options);
  
  router.get('/', (req, res) => {
    res.json(swaggerSpec);
  });

  // TODO: move to their own service, similar to dbsync reindex
  // router.use('/tar', require('./tar'));
  // router.use('/zip', require('./zip'));

})();

module.exports = router;