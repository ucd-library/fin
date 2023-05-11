const express = require('express');
const path = require('path');
const fs = require('fs');
const spaMiddleware = require('@ucd-lib/spa-router-middleware');
const {logger} = require('@ucd-lib/fin-service-utils');
const config = require('../config');


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
  let assetsDir = path.join(__dirname, '..', 'client', config.client.assets);
  logger.info('CLIENT_ENV='+config.client.env.CLIENT_ENV+', Serving static assets from '+assetsDir);

  let appRoutes = [];

  /**
   * Setup SPA app routes
   */
  spaMiddleware({
    app: app,
    htmlFile : path.join(assetsDir, 'index.html'),
    root : /^\/fin\/admin\/?$/,
    appRoutes : appRoutes,
    static : {
      opts : {
        basePath : '/fin/admin'
      },
      dir : assetsDir
    },
    getConfig : async (req, res, next) => {

      next({
        user : {},
        appRoutes,
        env : config.client.env,
      });
    },
    template : async (req, res, next) => {
      return next({
        bundle,
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