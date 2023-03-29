const {Router} = require('express');
const finAcMiddleware = require('../../fin-ac/middleware.js');
const logger = require('../../logger.js');

function createDefaultApi(model, opts={}) {
  let router = opts.router;
  if( !router ) router = Router();

  // all
  router.get('/', finAcMiddleware.esRoles, async (req, res) => {
    try {
      res.json(await model.all({
        roles : req.esRoles
      }));
    } catch(e) {
      res.json(errorResponse(e, 'Error with '+model.id+' retrieval'));
    }
  });

  // search
  router.post('/', finAcMiddleware.esRoles, async (req, res) => {
    if( !req.body ) {
      return res.json({error: true, message: 'no body sent'});
    }
  
    try {
      res.json(await model.search(req.body, {
        debug: req.query.debug,
        compact : req.query.compact ? true : false,
        singleNode : req.query['single-node'] ? true : false,
        roles : req.esRoles
      }));
    } catch(e) {
      res.json(errorResponse(e, 'Error with search query'));
    }
  });

  // get by id
  router.get('/*', finAcMiddleware.esRoles, async (req, res) => {
    try {
      let id = '/'+model.id+decodeURIComponent(req.path);
  
      let opts = {
        admin : req.query.admin ? true : false,
        compact : req.query.compact ? true : false,
        singleNode : req.query['single-node'] ? true : false,
        roles : req.esRoles
      }
  
      res.json(await model.get(id, opts));
    } catch(e) {
      res.json(errorResponse(e, 'Error with '+model.id+' retrieval'));
    }
  });

  return router;
}

function errorResponse(e, message) {
  logger.error(e);
  return {
    error: true, 
    message, 
    details : errorToDetails(e)
  }
}

function errorToDetails(e) {
  return {
    message : e.message,
    details : e.details,
    stack : e.stack
  }
}

module.exports = createDefaultApi;