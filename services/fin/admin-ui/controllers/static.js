const express = require('express');
const path = require('path');
const fs = require('fs');
const spaMiddleware = require('@ucd-lib/spa-router-middleware');
const {logger, keycloak} = require('@ucd-lib/fin-service-utils');
const config = require('../config');
const { buildInfo } = require('../../node-utils/config');


const loaderPath = path.join(__dirname, '..', 'client', config.client.assets, 'loader', 'loader.js');
const loaderSrc = fs.readFileSync(loaderPath, 'utf-8');
const bundle = `
  <script>
    var CORK_LOADER_VERSIONS = {
      loader : '${config.client.versions.loader}',
      bundle : '${config.client.versions.bundle}'
    }
    var CORK_LOADER_PATHS = {
      bundle : '/fin/admin/js'
    }
  </script>
  <script>${loaderSrc}</script>`;

module.exports = async (app) => {
  // make sure we are on the root path
  app.get('/fin/admin', (req, res, next) => {
    if( req.originalUrl === '/fin/admin' ) {
      return res.redirect('/fin/admin/');
    }
    next();
  });

  // make sure we are logged in
  app.all('/fin/admin/', (req, res, next) => {
    if( !req.user ) {
      res.redirect('/auth/login?redirectUrl=/fin/admin/');
      return;
    }
    
    let roles = req.user.roles || [];
    if( !roles.includes('admin') ) {
      res.redirect('/');
      return;
    }

    next();
  });


  let assetsDir = path.join(__dirname, '..', 'client', config.client.assets);
  logger.info('CLIENT_ENV='+config.client.env.CLIENT_ENV+', Serving static assets from '+assetsDir);

  let appRoutes = [];

  /**
   * Setup SPA app routes
   */
  spaMiddleware({
    app: app,
    htmlFile : path.join(assetsDir, 'index.html'),
    rootPath : /^\/fin\/admin\/$/,
    appRoutes : appRoutes,
    static : {
      opts : {
        basePath : '/fin/admin'
      },
      dir : assetsDir
    },
    getConfig : async (req, res, next) => {
      next({
        user : req.user,
        appRoutes,
        extensions : config.client.extensions,
        buildInfo : config.client.buildInfo,
        env : config.client.env,
      });
    },
    template : async (req, res, next) => {
      let extSrc = '';
      if( config.client.extensions.enabled ) {
        extSrc = `<script src="${config.client.extensions.sourcePath}"></script>`;
      }

      return next({
        bundle,
        extSrc,
        title : config.client.title
      });
    }
  });

  /**
   * Setup static asset dir
   */
  app.use(express.static(assetsDir, {
    immutable: true,
    maxAge: '1y'
  }));
}