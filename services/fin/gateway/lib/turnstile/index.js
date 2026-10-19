const crypto = require('crypto');
const {logger, config} = require('@ucd-lib/fin-service-utils');
const store = require('./store');
const allowlist = require('./allowlist');
const {getClientIp, toGroupKey} = require('./ip-group');

/**
 * @function sleep
 * @description promise wrapper around setTimeout
 *
 * @param {Number} ms milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @class Turnstile
 * @description Concurrency admission gate for direct, unauthenticated fcrepo
 * binary GET requests, grouped by client ip /24 (or ipv6 /64). Protects
 * fcrepo from a distributed bot network by capping how many such requests
 * from a single network block may be in flight at once, queueing a small
 * number more, and rejecting the rest with 429. State is coordinated across
 * gateway replicas via Postgres (see ./store.js); any Postgres error fails
 * the gate open rather than blocking traffic. Requests from a client ip on
 * the configured allowlist (see ./allowlist.js) bypass the gate entirely,
 * just like authenticated requests.
 */
class Turnstile {

  constructor() {
    if( config.gateway.turnstile.enabled ) {
      logger.info('turnstile: enabled');
    } else {
      logger.info('turnstile: disabled');
    }
  }

  /**
   * @method isInScope
   * @description decide whether turnstile should gate this request at all.
   * Only unauthenticated GET requests to a path that looks like a binary
   * (ends in a file extension), from a client ip not on the configured
   * allowlist, are in scope; everything else is ignored with no Postgres
   * access.
   *
   * @param {Object} req express request object
   * @returns {Boolean}
   */
  isInScope(req) {
    if( req.method !== 'GET' ) return false;
    if( req.user ) return false;
    let path = req.path || req.originalUrl || '';
    if( !config.gateway.turnstile.binaryPathRegex.test(path) ) return false;
    if( allowlist.isAllowed(getClientIp(req)) ) return false;
    return true;
  }

  /**
   * @method getIpGroup
   * @description resolve the ip group key for a request, using the
   * configured ipv4/ipv6 prefix lengths.
   *
   * @param {Object} req express request object
   * @returns {String} ip group key
   */
  getIpGroup(req) {
    let ip = getClientIp(req);
    return toGroupKey(ip, {
      v4PrefixLength : config.gateway.turnstile.ipv4PrefixLength,
      v6PrefixLength : config.gateway.turnstile.ipv6PrefixLength
    });
  }

  /**
   * @method admit
   * @description decide whether a request may proceed to fcrepo now. If the
   * request is out of scope, always proceeds with no Postgres access. If in
   * scope, attempts to claim an in-flight slot for the request's ip group;
   * if none are free, queues the request and waits (polling Postgres) until
   * admitted, until the client disconnects, or until the pending timeout
   * elapses. On any internal/Postgres error, logs and fails open.
   *
   * @param {Object} req express request object
   * @param {Object} res express response object
   * @returns {Promise<Boolean>} true if the caller should proceed to proxy
   * the request; false if this method already sent the HTTP response (429)
   * and the caller must return without further action
   */
  async admit(req, res) {
    if( !this.isInScope(req) ) return true;

    let group = this.getIpGroup(req);
    let requestId = crypto.randomUUID();
    let cfg = config.gateway.turnstile;

    try {
      if( await store.tryAdmit(requestId, group, cfg.maxServedPerGroup) ) {
        this._attachReleaseHooks(req, res, requestId, group);
        return true;
      }
    } catch(e) {
      logger.error('turnstile: postgres error on tryAdmit, failing open', e);
      return true;
    }

    let enqueued = false;
    try {
      enqueued = await store.enqueueIfRoom(requestId, group, cfg.maxPendingPerGroup);
    } catch(e) {
      logger.error('turnstile: postgres error on enqueueIfRoom, failing open', e);
      return true;
    }

    if( !enqueued ) {
      try {
        await store.reconcileStale(cfg.staleActiveMs);
      } catch(e) {
        logger.error('turnstile: postgres error on reconcileStale', e);
      }
      res.status(429).set('Retry-After', '5').send('Too many concurrent requests, please try again shortly');
      return false;
    }

    let outcome = await this._waitInQueue(req, requestId, group);

    if( outcome === 'admitted' ) {
      this._attachReleaseHooks(req, res, requestId, group);
      return true;
    }

    if( outcome === 'disconnected' ) {
      // client is already gone, nothing to send
      return false;
    }

    // timeout or internal error, fail closed with a 429 (error case already
    // logged inside _waitInQueue)
    res.status(429).set('Retry-After', '5').send('Too many concurrent requests, please try again shortly');
    return false;
  }

  /**
   * @method _attachReleaseHooks
   * @description attach completion/cleanup listeners to the response so an
   * active slot is always released (and the next queued request promoted)
   * exactly once, regardless of how the request ends.
   *
   * @param {Object} req express request object
   * @param {Object} res express response object
   * @param {String} requestId unique id for this request
   * @param {String} group ip group key
   */
  _attachReleaseHooks(req, res, requestId, group) {
    let released = false;
    let release = () => {
      if( released ) return;
      released = true;
      store.releaseAndPromote(requestId, group)
        .catch(e => logger.error('turnstile: postgres error on releaseAndPromote', e));
    };
    res.on('finish', release);
    res.on('close', release);
  }

  /**
   * @method _waitInQueue
   * @description poll Postgres until a queued request is promoted to
   * active, the client disconnects, or the pending timeout elapses.
   *
   * @param {Object} req express request object
   * @param {String} requestId unique id for this request
   * @param {String} group ip group key
   * @returns {Promise<'admitted'|'timeout'|'disconnected'>}
   */
  async _waitInQueue(req, requestId, group) {
    let cfg = config.gateway.turnstile;
    let disconnected = false;
    let onClose = () => { disconnected = true; };
    req.on('close', onClose);

    try {
      let elapsed = 0;

      while( elapsed < cfg.pendingTimeoutMs ) {
        if( disconnected ) {
          try {
            let removed = await store.expirePending(requestId, group);
            if( !removed && await store.isActive(requestId) ) {
              // promoted right as the client left, release it immediately
              await store.releaseAndPromote(requestId, group);
            }
          } catch(e) {
            logger.error('turnstile: postgres error cleaning up disconnected request', e);
          }
          return 'disconnected';
        }

        let active;
        try {
          active = await store.isActive(requestId);
        } catch(e) {
          logger.error('turnstile: postgres error polling isActive, failing open', e);
          return 'admitted';
        }
        if( active ) return 'admitted';

        await sleep(cfg.pollIntervalMs);
        elapsed += cfg.pollIntervalMs;
      }

      try {
        let removed = await store.expirePending(requestId, group);
        if( !removed ) {
          // lost the race with a concurrent promotion, check if we actually made it in
          if( await store.isActive(requestId) ) return 'admitted';
        }
      } catch(e) {
        logger.error('turnstile: postgres error expiring timed out request, failing open', e);
        return 'admitted';
      }

      return 'timeout';
    } finally {
      req.removeListener('close', onClose);
    }
  }
}

module.exports = new Turnstile();
