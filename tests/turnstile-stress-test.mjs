#!/usr/bin/env node
/**
 * Pure node/fetch stress test for the gateway's turnstile concurrency gate
 * (see services/fin/gateway/lib/turnstile/). No dependencies - uses Node's
 * built-in fetch.
 *
 * Fires bursts of concurrent requests at a real binary resource in fcrepo,
 * spoofing the Cloudflare CF-Connecting-IP header to simulate requests
 * arriving from different source networks. This only works against a
 * gateway that trusts that header (which, by design, is any gateway not
 * sitting directly behind Cloudflare's own edge) - fine for local testing,
 * never meaningful against a real Cloudflare-fronted deployment.
 *
 * Usage:
 *   node tests/turnstile-stress-test.mjs
 *
 * Config (all optional, via env vars):
 *   FIN_TEST_BASE_URL                base gateway url (default http://localhost:30000)
 *   FIN_TEST_PDF_PATH                path to a binary resource, must end in a file extension
 *   FIN_TEST_CONTAINER_PATH          path to a non-binary (no extension) resource, for bypass checks
 *   FIN_TEST_BURST_SIZE              concurrent requests per swarm scenario (default 10)
 *   FIN_TEST_ASSUMED_PENDING_TIMEOUT_MS  what you assume FIN_GATEWAY_TURNSTILE_PENDING_TIMEOUT_MS is set to (default 10000)
 *   FIN_TEST_TIMEOUT_CLASSIFY_MS      429s faster than this are labeled "queue full", slower are labeled "timed out" (default 2000)
 *   FIN_TEST_SCENARIO_PAUSE_MS        pause between scenarios so server-side state fully drains (default 1500)
 *   FIN_TEST_AUTH_COOKIE              optional cookie header value for the authenticated-bypass scenario; scenario is skipped if unset
 *   FIN_TEST_ALLOWLISTED_IP           spoofed ip for the allowlist-bypass scenario (default 169.237.1.100, inside the UC Davis
 *                                     campus range 169.237.0.0/16) - that range (or a range covering this ip) must be present
 *                                     in the target gateway's FIN_GATEWAY_TURNSTILE_ALLOWLIST for this scenario to pass
 *   FIN_TEST_SCENARIO                 key of a single scenario to run (default 'all'). One of: baseline, single-swarm,
 *                                     grouping, cross-group, ipv6, slow-drip, bypass, auth-bypass, allowlist-bypass,
 *                                     sequential, real-ip
 *
 * Most scenarios spoof CF-Connecting-IP, which only works against a gateway that isn't actually
 * sitting behind Cloudflare. To test a real dev/prod deployment behind Cloudflare's edge, run just
 * the 'real-ip' scenario (FIN_TEST_SCENARIO=real-ip) - it sends no spoofed header at all, so it
 * exercises the gate using your actual source ip, exactly as Cloudflare would report it.
 */

const BASE_URL = (process.env.FIN_TEST_BASE_URL || 'http://localhost:30000').replace(/\/$/, '');
const PDF_PATH = process.env.FIN_TEST_PDF_PATH || '/fcrepo/rest/item/ark:/87293/d33f4kv9z/media/Old_Vines_New_Lands-all.pdf';
const CONTAINER_PATH = process.env.FIN_TEST_CONTAINER_PATH || '/fcrepo/rest/item/ark:/87293/d33f4kv9z';
const BURST_SIZE = parseInt(process.env.FIN_TEST_BURST_SIZE || '10');
const ASSUMED_PENDING_TIMEOUT_MS = parseInt(process.env.FIN_TEST_ASSUMED_PENDING_TIMEOUT_MS || '10000');
const TIMEOUT_CLASSIFY_MS = parseInt(process.env.FIN_TEST_TIMEOUT_CLASSIFY_MS || '2000');
const SCENARIO_PAUSE_MS = parseInt(process.env.FIN_TEST_SCENARIO_PAUSE_MS || '1500');
const AUTH_COOKIE = process.env.FIN_TEST_AUTH_COOKIE || '';
const ALLOWLISTED_IP = process.env.FIN_TEST_ALLOWLISTED_IP || '169.237.1.100';
const SCENARIO = process.env.FIN_TEST_SCENARIO || 'all';

const PDF_URL = BASE_URL + PDF_PATH;
const CONTAINER_URL = BASE_URL + CONTAINER_PATH;

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m'
};

/**
 * @function col
 * @description wrap text in an ansi color code
 * @param {String} name key into the C color table
 * @param {String} s text to color
 * @returns {String}
 */
function col(name, s) { return `${C[name]}${s}${C.reset}`; }

/**
 * @function sleep
 * @description promise wrapper around setTimeout
 * @param {Number} ms milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * @function fireRequest
 * @description issue a single request, fully draining the response body
 * (so timing reflects the full download, matching how turnstile holds a
 * slot until the response finishes streaming), and capture status/timing.
 *
 * @param {Object} spec request spec
 * @param {String} spec.url target url
 * @param {String} [spec.method='GET']
 * @param {String} [spec.ip] value to send as the CF-Connecting-IP header
 * @param {String} [spec.cookie] value to send as the Cookie header
 * @param {String} [spec.label] human label for display
 * @param {String} [spec.tag] grouping tag used by callers to interpret results
 * @returns {Promise<Object>} result object merged with the original spec
 */
async function fireRequest(spec) {
  const headers = {};
  if( spec.ip ) headers['CF-Connecting-IP'] = spec.ip;
  if( spec.cookie ) headers['Cookie'] = spec.cookie;

  const start = Date.now();
  try {
    const res = await fetch(spec.url, {method: spec.method || 'GET', headers});
    if( res.body && spec.method !== 'HEAD' ) {
      const reader = res.body.getReader();
      while( true ) {
        const {done} = await reader.read();
        if( done ) break;
      }
    }
    return {
      ...spec,
      ok: true,
      status: res.status,
      retryAfter: res.headers.get('retry-after'),
      elapsed: Date.now() - start
    };
  } catch(e) {
    return {...spec, ok: false, status: null, error: e.message, elapsed: Date.now() - start};
  }
}

/**
 * @function classify
 * @description label each settled request as immediate/queued/rejected-full/
 * rejected-timeout/error, using the fastest successful response in the set
 * as a relative baseline (since absolute timing depends on resource size
 * and local network speed, not something this script controls).
 *
 * @param {Array<Object>} results settled fireRequest results
 * @returns {Array<Object>} same results, each with an added `outcome` field
 */
function classify(results) {
  const okTimes = results.filter(r => r.ok && r.status === 200).map(r => r.elapsed);
  const baseline = okTimes.length ? Math.min(...okTimes) : null;
  const immediateCutoff = baseline !== null ? Math.max(baseline * 1.5, baseline + 150) : null;

  return results.map(r => {
    if( !r.ok ) return {...r, outcome: 'error'};
    if( r.status === 200 ) {
      let outcome = (immediateCutoff !== null && r.elapsed <= immediateCutoff) ? 'immediate' : 'queued';
      return {...r, outcome};
    }
    if( r.status === 429 ) {
      return {...r, outcome: r.elapsed < TIMEOUT_CLASSIFY_MS ? 'rejected-full' : 'rejected-timeout'};
    }
    return {...r, outcome: 'unexpected-status'};
  });
}

const OUTCOME_STYLE = {
  'immediate': ['green', 'OK (immediate)'],
  'queued': ['yellow', 'OK (queued)'],
  'rejected-full': ['red', '429 (queue full)'],
  'rejected-timeout': ['magenta', '429 (timed out)'],
  'error': ['red', 'ERROR'],
  'unexpected-status': ['red', 'UNEXPECTED STATUS']
};

/**
 * @function badge
 * @description render a colored outcome badge for terminal display
 * @param {String} outcome one of the OUTCOME_STYLE keys
 * @returns {String}
 */
function badge(outcome) {
  const [color, text] = OUTCOME_STYLE[outcome] || ['gray', outcome];
  return col(color, text);
}

/**
 * @function liveSummary
 * @description build the single-line, in-place-updating status string shown
 * while a burst is in flight.
 * @param {Array<Object|null>} slots settled results so far, null for pending
 * @param {Number} startedAt Date.now() when the burst started
 * @returns {String}
 */
function liveSummary(slots, startedAt) {
  const total = slots.length;
  const settled = slots.filter(Boolean);
  const ok200 = settled.filter(r => r.ok && r.status === 200).length;
  const rej429 = settled.filter(r => r.ok && r.status === 429).length;
  const err = settled.filter(r => !r.ok).length;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  return `  ${col('dim', `${elapsed}s`)}  settled ${settled.length}/${total}  `
    + `${col('green', `200:${ok200}`)}  ${col('red', `429:${rej429}`)}  ${col('gray', `err:${err}`)}`;
}

/**
 * @function runBurst
 * @description fire a set of request specs concurrently, rendering a live,
 * in-place-updating status line while they're in flight, then print a
 * results table and return the classified results.
 *
 * @param {String} title scenario title
 * @param {String} description one-line explanation shown under the title
 * @param {Array<Object>} specs request specs (see fireRequest)
 * @returns {Promise<Array<Object>>} classified results, in spec order
 */
async function runBurst(title, description, specs) {
  console.log('\n' + col('bold', col('cyan', `▸ ${title}`)));
  console.log(col('dim', `  ${description}`));

  const slots = new Array(specs.length).fill(null);
  const startedAt = Date.now();

  const promises = specs.map((spec, i) =>
    fireRequest(spec).then(result => { slots[i] = result; return result; })
  );

  const timer = setInterval(() => {
    process.stdout.write('\r\x1b[2K' + liveSummary(slots, startedAt));
  }, 120);

  const settled = await Promise.all(promises);
  clearInterval(timer);
  process.stdout.write('\r\x1b[2K' + liveSummary(slots, startedAt) + '\n');

  const results = classify(settled);
  printTable(results);
  return results;
}

/**
 * @function printTable
 * @description print a simple fixed-width results table for a batch of
 * classified requests.
 * @param {Array<Object>} results classified fireRequest results
 */
function printTable(results) {
  const rows = results.map((r, i) => [
    String(i + 1).padStart(2),
    (r.label || r.ip || '-').slice(0, 28).padEnd(28),
    (r.method || 'GET').padEnd(4),
    r.ok ? String(r.status) : 'ERR',
    `${r.elapsed}ms`.padStart(8),
    badge(r.outcome)
  ]);
  console.log(col('dim', '    #  label/ip                      meth  status  elapsed  outcome'));
  for( const row of rows ) {
    console.log('    ' + row.join('  '));
  }
}

/**
 * @function printVerdict
 * @description print a colored pass/fail/info verdict line
 * @param {'PASS'|'FAIL'|'INFO'} level
 * @param {String} message
 */
function printVerdict(level, message) {
  const style = level === 'PASS' ? ['green', '✓ PASS'] : level === 'FAIL' ? ['red', '✗ FAIL'] : ['blue', 'ℹ INFO'];
  console.log('  ' + col(style[0], style[1]) + '  ' + message);
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

const scenarioReports = [];

/**
 * @function recordScenario
 * @description track a scenario's results for the final grand summary table
 * @param {String} name
 * @param {Array<Object>} results
 */
function recordScenario(name, results) {
  scenarioReports.push({
    name,
    total: results.length,
    ok: results.filter(r => r.ok && r.status === 200).length,
    rejected: results.filter(r => r.ok && r.status === 429).length,
    errors: results.filter(r => !r.ok || (r.ok && r.status !== 200 && r.status !== 429)).length
  });
}

async function scenarioBaseline() {
  const results = await runBurst(
    'Scenario 1: Baseline sanity check',
    'A single, unspoofed request to the test PDF. Confirms connectivity and establishes a rough timing baseline.',
    [{url: PDF_URL, label: 'local client'}]
  );
  recordScenario('1. Baseline', results);
  if( results[0].ok && results[0].status === 200 ) {
    printVerdict('PASS', `reachable, single download took ${results[0].elapsed}ms`);
  } else {
    printVerdict('FAIL', `expected 200 from a single request, got ${results[0].status ?? results[0].error}`);
  }
  return results;
}

async function scenarioSingleSwarm() {
  const ip = '203.0.113.50';
  const specs = Array.from({length: BURST_SIZE}, (_, i) => ({
    url: PDF_URL, ip, label: `bot #${i + 1} (${ip})`
  }));
  const results = await runBurst(
    'Scenario 2: One bot network hammers a single /24',
    `${BURST_SIZE} concurrent requests, all spoofed as coming from ${ip} (one IP group). Expect exactly one admitted immediately, several queued and served shortly after, and any overflow rejected with 429.`,
    specs
  );
  recordScenario('2. Single /24 swarm', results);

  const immediate = results.filter(r => r.outcome === 'immediate').length;
  const ok = results.filter(r => r.ok && r.status === 200).length;
  const rejected = results.filter(r => r.ok && r.status === 429).length;
  if( ok > 0 && (rejected > 0 || ok === results.length) ) {
    printVerdict('PASS', `${immediate} immediate, ${ok - immediate} queued, ${rejected} rejected - gate is actively shaping traffic for this group`);
  } else if( ok === results.length && rejected === 0 ) {
    printVerdict('INFO', `all ${ok} requests succeeded with no rejections - either turnstile is disabled, or its limits are configured higher than this burst size`);
  } else {
    printVerdict('FAIL', 'no successful requests at all - check FIN_TEST_BASE_URL/PDF_PATH and that the gateway is reachable');
  }
  return results;
}

async function scenarioRealIp() {
  const specs = Array.from({length: BURST_SIZE}, (_, i) => ({
    url: PDF_URL, label: `real client #${i + 1}`
  }));
  const results = await runBurst(
    'Scenario: real-ip burst (no spoofed header)',
    `${BURST_SIZE} concurrent requests sent with no CF-Connecting-IP header at all, so the gateway groups `
      + 'them by whatever source ip it actually sees (your real ip locally, or the ip Cloudflare reports for '
      + 'a dev/prod deployment behind its edge). Use this one against a real Cloudflare-fronted target, where '
      + 'the spoofed-header scenarios above do not apply.',
    specs
  );
  recordScenario('real-ip burst', results);

  const immediate = results.filter(r => r.outcome === 'immediate').length;
  const ok = results.filter(r => r.ok && r.status === 200).length;
  const rejected = results.filter(r => r.ok && r.status === 429).length;
  if( ok > 0 && (rejected > 0 || ok === results.length) ) {
    printVerdict('PASS', `${immediate} immediate, ${ok - immediate} queued, ${rejected} rejected - gate is actively shaping traffic from this real ip`);
  } else {
    printVerdict('FAIL', 'no successful requests at all - check FIN_TEST_BASE_URL/PDF_PATH and that the target is reachable');
  }
  return results;
}

async function scenarioGroupingCorrectness() {
  const prefix = '198.51.100.';
  const specs = Array.from({length: BURST_SIZE}, (_, i) => {
    const ip = prefix + (10 + i);
    return {url: PDF_URL, ip, label: `bot #${i + 1} (${ip})`};
  });
  const results = await runBurst(
    'Scenario 3: Same bot network, different source IPs (/24 grouping)',
    `${BURST_SIZE} concurrent requests, each from a DIFFERENT ip in ${prefix}0/24. If grouping is correct, this should look just like scenario 2 (one shared quota) - not like ${BURST_SIZE} independent IPs each getting their own slot.`,
    specs
  );
  recordScenario('3. /24 grouping', results);

  const ok = results.filter(r => r.ok && r.status === 200).length;
  const rejected = results.filter(r => r.ok && r.status === 429).length;
  if( rejected > 0 ) {
    printVerdict('PASS', `${ok} succeeded / ${rejected} rejected despite every request using a distinct ip - confirms requests are grouped by /24, not by exact ip`);
  } else {
    printVerdict('INFO', `all ${ok} requests succeeded - cannot distinguish /24 grouping from per-ip limiting at this burst size; try a larger FIN_TEST_BURST_SIZE`);
  }
  return results;
}

async function scenarioCrossGroupIsolation() {
  const ipA = '192.0.2.10';
  const ipB = '198.51.100.200';
  const specs = [
    ...Array.from({length: BURST_SIZE}, (_, i) => ({url: PDF_URL, ip: ipA, label: `group A #${i + 1}`, tag: 'A'})),
    ...Array.from({length: BURST_SIZE}, (_, i) => ({url: PDF_URL, ip: ipB, label: `group B #${i + 1}`, tag: 'B'}))
  ];
  const results = await runBurst(
    'Scenario 4: Two independent bot networks attack at the same time',
    `Two separate swarms of ${BURST_SIZE} fired simultaneously from ${ipA} and ${ipB}. Each group's own cap should apply independently - one group being throttled should not affect the other.`,
    specs
  );
  recordScenario('4. Cross-group isolation', results);

  const a = results.filter(r => r.tag === 'A');
  const b = results.filter(r => r.tag === 'B');
  const okA = a.filter(r => r.ok && r.status === 200).length;
  const okB = b.filter(r => r.ok && r.status === 200).length;
  const rejA = a.filter(r => r.ok && r.status === 429).length;
  const rejB = b.filter(r => r.ok && r.status === 429).length;
  console.log(col('dim', `    group A (${ipA}): ${okA} ok / ${rejA} rejected   |   group B (${ipB}): ${okB} ok / ${rejB} rejected`));

  if( okA > 0 && okB > 0 ) {
    printVerdict('PASS', 'both groups made independent progress - one swarm did not starve the other');
  } else {
    printVerdict('FAIL', 'one group made no progress at all while sharing the run with another group - check for cross-group bleed');
  }
  return results;
}

async function scenarioIpv6Grouping() {
  const sameGroupA = '2001:db8:aa:bb::10';
  const sameGroupB = '2001:db8:aa:bb::20';
  const otherGroup = '2001:db8:cc:dd::30';
  const specs = [
    ...Array.from({length: Math.ceil(BURST_SIZE / 2)}, (_, i) => ({url: PDF_URL, ip: i % 2 ? sameGroupA : sameGroupB, label: `v6 same /64 #${i + 1}`, tag: 'same'})),
    {url: PDF_URL, ip: otherGroup, label: 'v6 different /64', tag: 'other'}
  ];
  const results = await runBurst(
    'Scenario 5: IPv6 /64 grouping',
    `Requests alternating between two addresses in the same /64 (${sameGroupA} / ${sameGroupB}) plus one request from an unrelated /64 (${otherGroup}).`,
    specs
  );
  recordScenario('5. IPv6 grouping', results);

  const other = results.find(r => r.tag === 'other');
  if( other && other.ok && other.status === 200 ) {
    printVerdict('PASS', 'the unrelated /64 was served without being affected by the other group\'s swarm');
  } else {
    printVerdict('INFO', `unrelated /64 request returned ${other ? other.status : 'no result'} - re-run with a larger burst if this group also got saturated`);
  }
  return results;
}

async function scenarioSlowDripTimeout() {
  const ip = '192.0.2.99';
  console.log('\n' + col('bold', col('cyan', '▸ Scenario 6: Slow consumer exhausts the pending queue timeout')));
  console.log(col('dim', `  One request deliberately reads its response very slowly, holding the only slot for this group`));
  console.log(col('dim', `  for longer than the assumed pending timeout (${ASSUMED_PENDING_TIMEOUT_MS}ms). A second wave queued behind it`));
  console.log(col('dim', `  should start getting 429'd once they've waited that long.`));

  const holdMs = ASSUMED_PENDING_TIMEOUT_MS + 4000;
  const slowStart = Date.now();
  const slowPromise = (async () => {
    const start = Date.now();
    try {
      const res = await fetch(PDF_URL, {headers: {'CF-Connecting-IP': ip}});
      if( res.body ) {
        const reader = res.body.getReader();
        await reader.read();
        await sleep(holdMs);
        while( true ) {
          const {done} = await reader.read();
          if( done ) break;
        }
      }
      return {label: 'slow drip holder', ip, ok: true, status: res.status, elapsed: Date.now() - start, outcome: 'immediate'};
    } catch(e) {
      return {label: 'slow drip holder', ip, ok: false, error: e.message, elapsed: Date.now() - start, outcome: 'error'};
    }
  })();

  // give the slow holder a head start so it reliably claims the single slot first
  await sleep(500);

  const waveSpecs = Array.from({length: 3}, (_, i) => ({
    url: PDF_URL, ip, label: `queued wave #${i + 1}`
  }));
  const waveResults = await runBurst(
    '  (secondary wave, queued behind the slow holder)',
    `3 more requests from ${ip}, fired while the slow holder is still mid-download.`,
    waveSpecs
  );

  const slowResult = await slowPromise;
  console.log(col('dim', `    slow drip holder finished after ${slowResult.elapsed}ms, status ${slowResult.ok ? slowResult.status : slowResult.error}`));

  const allResults = [slowResult, ...waveResults];
  recordScenario('6. Slow drip / pending timeout', allResults);

  const timedOut = waveResults.filter(r => r.outcome === 'rejected-timeout').length;
  const queuedOk = waveResults.filter(r => r.outcome === 'queued').length;
  if( timedOut > 0 ) {
    printVerdict('PASS', `${timedOut} of ${waveResults.length} queued requests were rejected after waiting out the pending timeout`);
  } else if( queuedOk > 0 ) {
    printVerdict('INFO', `all queued requests eventually succeeded (none waited past ${ASSUMED_PENDING_TIMEOUT_MS}ms) - the slow holder may have released before you expected, or the real configured timeout is longer than assumed`);
  } else {
    printVerdict('INFO', 'no queued requests were admitted or timed out as expected - re-check FIN_TEST_ASSUMED_PENDING_TIMEOUT_MS against the gateway\'s actual configuration');
  }
  return allResults;
}

async function scenarioBypass() {
  const ip = '203.0.113.150';
  console.log('\n' + col('bold', col('cyan', '▸ Scenario 7: non-GET and non-binary requests always bypass the gate')));
  console.log(col('dim', `  While a saturating GET swarm from ${ip} is in flight, fire HEAD requests to the same binary`));
  console.log(col('dim', '  and GET requests to a non-binary (extensionless) container path, from the same exhausted ip.'));
  console.log(col('dim', '  Both should always succeed - turnstile only ever gates GET requests to binary-shaped paths.'));

  const saturating = Array.from({length: BURST_SIZE}, (_, i) => fireRequest({
    url: PDF_URL, ip, label: `saturating GET #${i + 1}`, tag: 'saturating'
  }));
  const bypassSpecs = [
    ...Array.from({length: 3}, (_, i) => ({url: PDF_URL, method: 'HEAD', ip, label: `HEAD #${i + 1}`, tag: 'bypass'})),
    ...Array.from({length: 3}, (_, i) => ({url: CONTAINER_URL, ip, label: `container GET #${i + 1}`, tag: 'bypass'}))
  ];
  const bypassPromises = bypassSpecs.map(fireRequest);

  const slots = new Array(saturating.length + bypassPromises.length).fill(null);
  const all = [...saturating, ...bypassPromises];
  all.forEach((p, i) => p.then(r => { slots[i] = r; }));
  const startedAt = Date.now();
  const timer = setInterval(() => {
    process.stdout.write('\r\x1b[2K' + liveSummary(slots, startedAt));
  }, 120);

  const settled = await Promise.all(all);
  clearInterval(timer);
  process.stdout.write('\r\x1b[2K' + liveSummary(slots, startedAt) + '\n');

  const results = classify(settled);
  printTable(results);
  recordScenario('7. Method/path bypass', results);

  const bypassResults = results.filter(r => r.tag === 'bypass');
  const bypassFailures = bypassResults.filter(r => !(r.ok && r.status === 200));
  if( bypassFailures.length === 0 ) {
    printVerdict('PASS', `all ${bypassResults.length} HEAD/non-binary requests succeeded despite the concurrent saturating swarm`);
  } else {
    printVerdict('FAIL', `${bypassFailures.length} of ${bypassResults.length} HEAD/non-binary requests were throttled - scope check is not working as intended`);
  }
  return results;
}

async function scenarioAuthBypass() {
  console.log('\n' + col('bold', col('cyan', '▸ Scenario 8: authenticated requests bypass the gate')));
  if( !AUTH_COOKIE ) {
    console.log(col('dim', '  Skipped - set FIN_TEST_AUTH_COOKIE to a valid session cookie (e.g. "jwt=...") to run this scenario.'));
    recordScenario('8. Auth bypass (skipped)', []);
    printVerdict('INFO', 'skipped, no FIN_TEST_AUTH_COOKIE provided');
    return [];
  }

  const ip = '203.0.113.151';
  const specs = Array.from({length: BURST_SIZE}, (_, i) => ({
    url: PDF_URL, ip, cookie: AUTH_COOKIE, label: `authed #${i + 1}`
  }));
  const results = await runBurst(
    '  (continued)',
    `${BURST_SIZE} concurrent authenticated requests from a single spoofed ip. All should succeed - turnstile bypasses any request with a valid session.`,
    specs
  );
  recordScenario('8. Auth bypass', results);

  const failures = results.filter(r => !(r.ok && r.status === 200));
  if( failures.length === 0 ) {
    printVerdict('PASS', 'all authenticated requests succeeded regardless of swarm size');
  } else {
    printVerdict('FAIL', `${failures.length} authenticated requests were throttled - check that req.user is being set correctly for this cookie`);
  }
  return results;
}

async function scenarioAllowlistBypass() {
  const ip = ALLOWLISTED_IP;
  const specs = Array.from({length: BURST_SIZE}, (_, i) => ({
    url: PDF_URL, ip, label: `allowlisted #${i + 1}`
  }));
  const results = await runBurst(
    'Scenario 9: allowlisted ip bypasses the gate',
    `${BURST_SIZE} concurrent requests spoofed as coming from ${ip}, inside the UC Davis campus range `
      + '(169.237.0.0/16). Assumes a range covering this ip is present in the gateway\'s '
      + 'FIN_GATEWAY_TURNSTILE_ALLOWLIST - all requests should succeed regardless of swarm size, just like '
      + 'an authenticated client.',
    specs
  );
  recordScenario('9. Allowlist bypass', results);

  const failures = results.filter(r => !(r.ok && r.status === 200));
  if( failures.length === 0 ) {
    printVerdict('PASS', 'all allowlisted requests succeeded regardless of swarm size');
  } else {
    printVerdict('FAIL', `${failures.length} allowlisted requests were throttled - confirm ${ip} falls inside a range `
      + 'configured in FIN_GATEWAY_TURNSTILE_ALLOWLIST on the gateway under test');
  }
  return results;
}

async function scenarioSequentialFairUse() {
  const ip = '203.0.113.75';
  console.log('\n' + col('bold', col('cyan', '▸ Scenario 10: fair use - sequential single client is never throttled')));
  console.log(col('dim', `  5 requests from a single ip (${ip}), fired one at a time, each waiting for the prior to`));
  console.log(col('dim', '  fully complete before the next starts. This client never has more than 1 request in'));
  console.log(col('dim', '  flight, so it should always be admitted immediately - confirms turnstile gates actual'));
  console.log(col('dim', '  concurrency, not a well-behaved client\'s overall request rate.'));

  const results = [];
  for( let i = 0; i < 5; i++ ) {
    const result = await fireRequest({url: PDF_URL, ip, label: `sequential #${i + 1}`});
    results.push(result);
    const style = result.ok && result.status === 200 ? 'green' : 'red';
    console.log('    ' + col(style, `#${i + 1}`) + `  status ${result.ok ? result.status : result.error}  ${result.elapsed}ms`);
  }

  const classified = classify(results);
  printTable(classified);
  recordScenario('10. Sequential fair use', classified);

  const failures = classified.filter(r => !(r.ok && r.status === 200));
  if( failures.length === 0 ) {
    printVerdict('PASS', 'all 5 sequential (non-overlapping) requests succeeded - fair use is not throttled by turnstile');
  } else {
    printVerdict('FAIL', `${failures.length} of 5 sequential requests were throttled - a single well-behaved client should never hit the concurrency gate`);
  }
  return classified;
}

/**
 * @function printGrandSummary
 * @description print the final cross-scenario results table
 */
function printGrandSummary() {
  console.log('\n' + col('bold', '═══ Final Summary ═══') + '\n');
  console.log(col('dim', '    scenario                              total   200   429   other'));
  for( const s of scenarioReports ) {
    console.log(
      '    ' + s.name.padEnd(38) +
      String(s.total).padStart(5) + '   ' +
      col('green', String(s.ok).padStart(3)) + '   ' +
      col('red', String(s.rejected).padStart(3)) + '   ' +
      col('gray', String(s.errors).padStart(5))
    );
  }

  const anyRejections = scenarioReports.some(s => s.rejected > 0);
  console.log('');
  if( !anyRejections ) {
    console.log(col('yellow', 'Note: no request in any scenario was ever rejected with 429.'));
    console.log(col('yellow', 'Check that FIN_GATEWAY_TURNSTILE_ENABLED=true on the gateway, or try a larger FIN_TEST_BURST_SIZE.'));
  } else {
    console.log(col('green', 'Turnstile is actively gating traffic - rejections observed in at least one scenario.'));
  }
}

async function main() {
  console.log(col('bold', '\n┌─────────────────────────────────────────────────────────┐'));
  console.log(col('bold', '│  Turnstile concurrency gate - stress test                │'));
  console.log(col('bold', '└─────────────────────────────────────────────────────────┘'));
  console.log(col('dim', `  base url:        ${BASE_URL}`));
  console.log(col('dim', `  binary resource: ${PDF_PATH}`));
  console.log(col('dim', `  container:       ${CONTAINER_PATH}`));
  console.log(col('dim', `  burst size:      ${BURST_SIZE}`));
  console.log(col('dim', `  assumed pending timeout: ${ASSUMED_PENDING_TIMEOUT_MS}ms`));
  console.log(col('dim', `  allowlist test ip:       ${ALLOWLISTED_IP}`));

  const scenarios = [
    {key: 'baseline', fn: scenarioBaseline},
    {key: 'real-ip', fn: scenarioRealIp},
    {key: 'single-swarm', fn: scenarioSingleSwarm},
    {key: 'grouping', fn: scenarioGroupingCorrectness},
    {key: 'cross-group', fn: scenarioCrossGroupIsolation},
    {key: 'ipv6', fn: scenarioIpv6Grouping},
    {key: 'slow-drip', fn: scenarioSlowDripTimeout},
    {key: 'bypass', fn: scenarioBypass},
    {key: 'auth-bypass', fn: scenarioAuthBypass},
    {key: 'allowlist-bypass', fn: scenarioAllowlistBypass},
    {key: 'sequential', fn: scenarioSequentialFairUse}
  ];

  let toRun = scenarios;
  if( SCENARIO !== 'all' ) {
    toRun = scenarios.filter(s => s.key === SCENARIO);
    if( !toRun.length ) {
      console.error(col('red', `\nUnknown FIN_TEST_SCENARIO '${SCENARIO}'. Valid keys: ${scenarios.map(s => s.key).join(', ')}, all`));
      process.exit(1);
    }
  }
  console.log(col('dim', `  scenario filter: ${SCENARIO}`));

  for( const scenario of toRun ) {
    await scenario.fn();
    await sleep(SCENARIO_PAUSE_MS);
  }

  printGrandSummary();
}

main().catch(e => {
  console.error(col('red', '\nstress test crashed: ' + e.stack));
  process.exit(1);
});
