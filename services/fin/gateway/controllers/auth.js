const router = require('express').Router();
const {keycloak} = require('@ucd-lib/fin-service-utils');
const path = require('path');
const fs = require('fs-extra');
const serviceModel = require('../models/services.js');

const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');

router.get('/user', keycloak.setUser, async ( req, res ) => {
  if( req.user ) {
    res.json(req.user);
  } else {
    res.json({loggedIn: false});
  }
});

router.get('/login', (req, res) => {
  // find the first authenicated service and redirect to it
  for( let key in serviceModel.services ) {
    let service = serviceModel.services[key];
    if( service.type === 'AuthenticationService' ) {
      let redirectPath = `/auth/${key}/login`;
      if( req.query.redirectUrl ) {
        redirectPath += `?redirectUrl=${req.query.redirectUrl}`;
      }
      return res.redirect(redirectPath);
    }
  }
});

router.get('/logout', (req, res) => {
  if( req.cookies ) {
    for( var key in req.cookies ) {
      res.clearCookie(key);
    }
  }
  
  if( req.session ) {
    req.session = null;
  }
  res.redirect('/');
});

router.get('/login-shell', async (req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(await fs.readFile(path.join(ASSETS_DIR, 'login-shell.html'), 'utf-8'));
});

module.exports = router;