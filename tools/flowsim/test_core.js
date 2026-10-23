// Runs the CORE flows (core/data/flows.json) against a real PostgreSQL, using the flow simulator.
//   PGCONN="-h localhost -p 5432 -U postgres -d manufaction" node tools/flowsim/test_core.js
// The database must already have postgres/init/001_schema.sql and 002_seed.sql applied.
const fs = require('fs'), path = require('path'), Module = require('module');
const { makeDb } = require('./pgshim');
const { Engine } = require('./engine');

const root = path.join(__dirname, '..', '..');
const conn = process.env.PGCONN || '-h /tmp -p 54335 -U postgres -d manufaction';

// load the real settings.js (for mfAuthorize) with a stub in place of the pg driver
const orig = Module._load;
Module._load = function (r, ...a) {
    if (r === 'pg') return { Pool: class { on() {} }, types: { setTypeParser() {} } };
    return orig.call(this, r, ...a);
};
process.env.MF_API_TOKEN = 'a'.repeat(40);
const settings = require(path.join(root, 'core', 'data', 'settings.js'));
Module._load = orig;

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = { authorization: 'Bearer ' + 'a'.repeat(40) };
const T = (a, k) => `mf/v1/site/demo/asset/${a}/${k}`;

(async () => {
    const db = makeDb(conn);
    await db.query(`TRUNCATE mf.telemetry, mf.asset_signals, mf.notifications, mf.maintenance_requests, mf.quality_events,
        mf.production_events, mf.downtime_events, mf.production_orders, demo_erp.production_receipts RESTART IDENTITY`);
    await db.query(`ALTER SEQUENCE mf.work_request_seq RESTART`);
    await db.query(`UPDATE mf.assets SET status='offline', status_changed_at=NULL, last_seen_at=NULL`);

    const flows = JSON.parse(fs.readFileSync(path.join(root, 'core', 'data', 'flows.json'), 'utf8'));
    const env = { MF_API_TOKEN: 'a'.repeat(40), DEMO_ERP_ENABLED: 'true', MF_NOTIFY_WEBHOOK_URL: 'https://hooks.example.test/T000/SECRET', MF_NOTIFY_FORMAT: 'slack' };
    const e = new Engine(flows, { db, env, globals: { db, mfAuthorize: settings.functionGlobalContext.mfAuthorize } });
    await e.init();
    const api = (m, p, body, auth = true) => e.request(m, p, { headers: auth ? TOKEN : {}, body });
    const rows = async (sql, p) => (await db.query(sql, p)).rows;

    console.log('settings and library');
    ok(!!e.global('lib'), 'library started');
    await e.fire('cfg_tick');
    ok(e.global('cfg') && Object.keys(e.global('cfg').reasons).length === 9, 'settings + 9 reason codes loaded', e.global('cfg'));
    ok(e.global('cfg').offline_after_seconds === 30 && Array.isArray(e.global('cfg').downtime_statuses), 'setting types are correct');

    console.log('REST API: health and auth');
    let r = await api('GET', '/api/v1/health', undefined, false);
    ok(r.status === 200 && r.body.status === 'ok', 'health is public', r);
    r = await api('GET', '/api/v1/assets', undefined, false);
    ok(r.status === 401, 'assets without token = 401', r.status);
    r = await e.request('GET', '/api/v1/assets', { headers: { authorization: 'Bearer wrong' } });
    ok(r.status === 401, 'wrong token = 401');

    console.log('ingestion: a machine comes online');
    await e.mqtt(T('PRESS-001', 'status'), { status: 'idle' });
    await e.mqtt(T('PRESS-001', 'event'), { event_type: 'online' });
    await e.mqtt(T('PRESS-001', 'telemetry'), { signals: { temperature: 185.2, pressure: 300, cycle_count: 0, mode: 'auto' }, units: { temperature: 'degF', pressure: 'psi' } });
    r = await api('GET', '/api/v1/assets/PRESS-001');
    ok(r.status === 200 && r.body.status === 'idle', 'PRESS-001 is idle via the API', r.body);
    ok(r.body.signals.temperature && r.body.signals.temperature.value === 185.2 && r.body.signals.temperature.unit === 'degF', 'numeric signal + unit stored');
    ok(r.body.signals.mode && r.body.signals.mode.value === 'auto', 'text signal stored');
    r = await api('GET', '/api/v1/assets');
    ok(r.status === 200 && r.body.length === 6, 'six assets listed', r.body && r.body.length);
    ok(r.body.find((a) => a.asset === 'CNC-001').status === 'offline', 'a silent machine is offline');
    r = await api('GET', '/api/v1/assets/NOPE');
    ok(r.status === 404, 'unknown asset = 404');

    console.log('orders: release, start, count, complete');
    r = await api('POST', '/api/v1/production-orders', { asset: 'PRESS-001', order_number: 'T-1', target_quantity: 3, source_system: 'TEST' });
    ok(r.status === 201 && r.body.status === 'released' && r.body.part_number === 'BRKT-100', 'order released (part number defaulted)', r);
    ok(e.published.some((m) => m.topic === T('PRESS-001', 'command') && m.json.command === 'start_order' && m.json.order_number === 'T-1'), 'start_order published to the machine');
    r = await api('POST', '/api/v1/production-orders', { asset: 'PRESS-001', order_number: 'T-2', target_quantity: 5 });
    ok(r.status === 409, 'second open order for a machine = 409', r.status);
    r = await api('POST', '/api/v1/production-orders', { asset: 'NOPE', order_number: 'T-3', target_quantity: 5 });
    ok(r.status === 404, 'order for unknown asset = 404', r.status);
    r = await api('POST', '/api/v1/production-orders', { asset: 'CNC-001', order_number: 'T-4', target_quantity: 0 });
    ok(r.status === 400, 'zero quantity = 400', r.status);
    r = await api('GET', '/api/v1/production/T-1');
    ok(r.status === 200 && r.body.completed_quantity === 0, 'get order by number');

    await e.mqtt(T('PRESS-001', 'event'), { event_type: 'order_started', order_number: 'T-1' });
    r = await api('GET', '/api/v1/production/T-1');
    ok(r.body.status === 'running', 'order_started -> running', r.body);
    const cyc = (q, extra) => e.mqtt(T('PRESS-001', 'event'), Object.assign({ event_type: 'cycle_complete', quality_result: q }, extra));
    await cyc('good'); await cyc('scrap', { defect_code: 'BURR' }); await cyc('good');
    r = await api('GET', '/api/v1/production/T-1');
    ok(r.body.completed_quantity === 2 && r.body.scrap_quantity === 1 && r.body.status === 'running', 'parts counted (2 good, 1 scrap)', r.body);
    const before = e.published.length;
    await cyc('good');
    r = await api('GET', '/api/v1/production/T-1');
    ok(r.body.status === 'complete' && r.body.completed_quantity === 3, 'order completes at target', r.body);
    ok(e.published.slice(before).some((m) => m.json.command === 'complete_order' && m.json.order_number === 'T-1'), 'complete_order sent to machine');
    let rec = await rows('SELECT * FROM demo_erp.production_receipts');
    ok(rec.length === 1 && rec[0].order_number === 'T-1' && rec[0].good_quantity === 3 && rec[0].scrap_quantity === 1, 'receipt stored in the demo ERP', rec);
    await cyc('good');                                  // stray cycle after completion must not create a second receipt
    rec = await rows('SELECT * FROM demo_erp.production_receipts');
    ok(rec.length === 1, 'no duplicate receipt for a completed order');
    const q = await rows(`SELECT result, count(*)::int AS n FROM mf.quality_events GROUP BY 1 ORDER BY 1`);
    ok(JSON.stringify(q) === JSON.stringify([{ result: 'good', n: 4 }, { result: 'scrap', n: 1 }]), 'quality events recorded', q);
    await e.mqtt(T('PRESS-001', 'event'), { event_type: 'cycle_complete', quantity: 99999 });
    const big = await rows(`SELECT quantity FROM mf.production_events ORDER BY id DESC LIMIT 1`);
    ok(big[0].quantity === 1, 'absurd quantity is treated as 1', big);

    console.log('downtime, alerts and maintenance');
    await e.mqtt(T('PRESS-001', 'status'), { status: 'faulted', reason_code: 'OVERTEMP' });
    let dt = await rows(`SELECT * FROM mf.downtime_events`);
    ok(dt.length === 1 && dt[0].status === 'faulted' && dt[0].ended_at === null, 'downtime opened');
    ok(dt[0].reason_description === 'Hydraulic oil over temperature', 'reason text filled from the catalogue', dt[0]);
    let wr = await rows(`SELECT * FROM mf.maintenance_requests`);
    ok(wr.length === 1 && /^WR-\d{6}-001$/.test(wr[0].request_number) && wr[0].assigned_to === 'Maintenance on-call' && wr[0].status === 'open', 'work request raised and assigned to the default', wr);
    let nt = await rows(`SELECT kind, severity, message FROM mf.notifications ORDER BY id`);
    ok(nt.length === 2 && nt[0].kind === 'downtime_alert' && nt[0].severity === 'critical' && nt[1].kind === 'maintenance_dispatched' && /sent to Maintenance on-call/.test(nt[1].message), 'alert + dispatch notices written', nt);
    r = await api('GET', '/api/v1/assets/PRESS-001');
    ok(r.body.open_downtime && r.body.open_downtime.work_request === wr[0].request_number, 'API shows open downtime with the work request');
    await e.mqtt(T('PRESS-001', 'status'), { status: 'faulted', reason_code: 'OVERTEMP' });   // repeat announcement
    ok((await rows(`SELECT count(*)::int n FROM mf.downtime_events`))[0].n === 1, 'repeated status does not open a second downtime');
    await e.mqtt(T('PRESS-001', 'status'), { status: 'running' });
    dt = await rows(`SELECT * FROM mf.downtime_events`);
    ok(dt[0].ended_at !== null && dt[0].duration_seconds >= 0, 'downtime closed on recovery');
    wr = await rows(`SELECT * FROM mf.maintenance_requests`);
    ok(wr[0].status === 'closed' && wr[0].closed_at, 'work request closed');
    nt = await rows(`SELECT kind, severity, message FROM mf.notifications ORDER BY id`);
    ok(nt.length === 3 && nt[2].kind === 'recovered' && nt[2].severity === 'success' && /^Down for /.test(nt[2].message), 'recovery notice written', nt[2]);

    await e.mqtt(T('CNC-001', 'status'), { status: 'idle' });
    await e.mqtt(T('CNC-001', 'status'), { status: 'stopped', reason_code: 'DOOR_OPEN' });
    nt = await rows(`SELECT n.kind, n.severity FROM mf.notifications n JOIN mf.assets a ON a.id=n.asset_id WHERE a.asset_code='CNC-001'`);
    ok(nt.length === 1 && nt[0].kind === 'downtime_alert' && nt[0].severity === 'warning', 'a stop raises an alert at the catalogue severity (warning)', nt);
    ok((await rows(`SELECT count(*)::int n FROM mf.maintenance_requests`))[0].n === 1, 'a stop does not raise a work request (setting)');
    await e.mqtt(T('CNC-001', 'status'), { status: 'idle' });

    // customer changes a rule in the database: stops now also raise work requests, assigned by reason code
    await db.query(`UPDATE mf.settings SET value = '["faulted","stopped"]' WHERE key = 'work_request_statuses'`);
    await e.fire('cfg_tick');
    await e.mqtt(T('CNC-001', 'status'), { status: 'stopped', reason_code: 'DOOR_OPEN' });
    wr = await rows(`SELECT assigned_to, request_number FROM mf.maintenance_requests ORDER BY id`);
    ok(wr.length === 2 && wr[1].assigned_to === 'Shift supervisor' && /-002$/.test(wr[1].request_number), 'changing a setting changes behaviour with no flow edit (assignee from reason code)', wr);
    await e.mqtt(T('CNC-001', 'status'), { status: 'idle' });
    await db.query(`UPDATE mf.settings SET value = '["faulted"]' WHERE key = 'work_request_statuses'`);
    await e.fire('cfg_tick');

    console.log('rejected input');
    const w0 = e.warnings.length;
    await e.mqtt(T('PRESS-001', 'status'), { status: 'exploding' });
    await e.mqtt(T('NOPE-9', 'status'), { status: 'idle' });
    await e.mqtt('mf/v1/site/demo/asset/PRESS-001/event', '{not json');
    await e.mqtt('garbage/topic', {});
    await e.mqtt(T('PRESS-001', 'telemetry'), { signals: 'nope' });
    ok(e.warnings.length >= w0 + 2, 'bad topic / bad JSON are warned about', e.warnings.slice(w0));
    ok((await rows(`SELECT status FROM mf.assets WHERE asset_code='PRESS-001'`))[0].status === 'running', 'an invalid status does not change the machine');

    console.log('alert delivery (webhook)');
    await e.fire('ntf_tick');
    ok(e.http.length >= 1, 'alerts were POSTed to the webhook', e.http.length);
    const texts = e.http.map((h) => h.payload && h.payload.text);
    ok(texts.some((t) => /^FAULT: PRESS-001 - Hydraulic oil over temperature\. Work request WR-\d{6}-001 sent to Maintenance on-call\.$/.test(t)), 'fault message wording', texts);
    ok(texts.some((t) => /^BACK IN PRODUCTION: PRESS-001 - Down for/.test(t)), 'recovery message wording', texts);
    ok(!texts.some((t) => /^STOPPED: PRESS-001/.test(t)), 'the alert covered by a work-request message is not sent twice');
    const und = await rows(`SELECT count(*)::int n FROM mf.notifications WHERE delivered_at IS NULL AND kind <> 'downtime_alert'`);
    ok(und[0].n === 0, 'delivered alerts are marked delivered', und);
    const n1 = e.http.length; await e.fire('ntf_tick');
    ok(e.http.length === n1, 'delivered alerts are not sent again');
    await db.query(`INSERT INTO mf.notifications (kind, severity, title, message) VALUES ('test','info','Test notification','x')`);
    e.httpFail = 'getaddrinfo ENOTFOUND hooks.example.test https://hooks.example.test/T000/SECRET';
    await e.fire('ntf_tick');
    const fl = await rows(`SELECT delivery_attempts, last_error, delivered_at FROM mf.notifications WHERE kind='test'`);
    ok(fl[0].delivery_attempts === 1 && fl[0].delivered_at === null && fl[0].last_error && !/SECRET|https?:/.test(fl[0].last_error), 'a failed send is recorded without leaking the URL', fl);
    e.httpFail = null;
    await db.query(`UPDATE mf.notifications SET last_attempt_at = now() - interval '1 minute' WHERE kind='test'`);
    await e.fire('ntf_tick');
    ok((await rows(`SELECT delivered_at FROM mf.notifications WHERE kind='test'`))[0].delivered_at !== null, 'a failed alert is retried and then delivered');
    ok(e.http.every((h) => h.headers['content-type'] === 'application/json'), 'slack format sends JSON');

    console.log('dispatch and demo ERP');
    await e.mqtt(T('CNC-001', 'status'), { status: 'idle' });
    await api('POST', '/api/v1/production-orders', { asset: 'CNC-001', order_number: 'T-CNC', target_quantity: 5 });
    const p0 = e.published.length;
    await e.fire('disp_tick');
    ok(e.published.slice(p0).some((m) => m.json && m.json.command === 'start_order' && m.json.order_number === 'T-CNC'), 'unacknowledged order is re-sent', e.published.slice(p0));
    const p1 = e.published.length; await e.fire('disp_tick');
    ok(e.published.length === p1, 'dispatcher respects the retry interval');
    await e.mqtt(T('CNC-001', 'event'), { event_type: 'order_started', order_number: 'T-CNC' });
    e.nodeCtx.get('disp_fn').set('last', 0);
    const p2 = e.published.length; await e.fire('disp_tick');
    ok(e.published.length === p2, 'a started order is not re-sent');
    await e.mqtt(T('PRESS-001', 'status'), { status: 'idle' });
    await e.fire('erp_tick');
    const ord = await rows(`SELECT * FROM mf.production_orders WHERE source_system='DEMO-ERP'`);
    ok(ord.length >= 1 && ord.every((o) => /^MO-\d{6}-\d{4}$/.test(o.order_number)), 'demo ERP released an order through the API', ord);
    const pr = ord.find((o) => o.asset_id);
    ok(ord.some((o) => o.part_number === 'BRKT-100' && o.target_quantity >= 30 && o.target_quantity <= 60), 'press order size within its range');
    ok(!ord.some((o) => o.part_number === 'SHAFT-220'), 'a machine that already has an order gets no second one');

    console.log('REST ingestion paths and housekeeping');
    const p3 = e.published.length;
    r = await api('POST', '/api/v1/telemetry', { asset_id: 'ASSEMBLY-001', station_temp: 71.5 });
    ok(r.status === 202 && e.published.length === p3 + 1, 'POST telemetry (flat body) accepted and published', r);
    await e.mqtt(e.published[e.published.length - 1].topic, e.published[e.published.length - 1].payload);
    ok((await rows(`SELECT 1 FROM mf.telemetry t JOIN mf.asset_signals s ON s.id=t.signal_id WHERE s.signal_name='station_temp'`)).length === 1, 'REST telemetry reaches the database through the MQTT path');
    r = await api('POST', '/api/v1/events', { asset: 'PRESS-001' });
    ok(r.status === 400, 'event without type = 400', r.status);
    r = await api('GET', '/api/v1/downtime');
    ok(r.status === 200 && r.body.length >= 3 && r.body[0].asset, 'downtime list', r.body && r.body.length);
    r = await api('GET', '/api/v1/production');
    ok(r.status === 200 && r.body.length >= 2, 'order list');
    await db.query(`INSERT INTO mf.telemetry (asset_id, value_numeric, recorded_at) SELECT id, 1, now() - interval '30 days' FROM mf.assets LIMIT 1`);
    await e.fire('purge_tick');
    ok((await rows(`SELECT count(*)::int n FROM mf.telemetry WHERE recorded_at < now() - interval '8 days'`))[0].n === 0, 'old telemetry purged');

    console.log('offline detection');
    await db.query(`UPDATE mf.assets SET last_seen_at = now() - interval '5 minutes' WHERE asset_code = 'PRESS-001'`);
    r = await api('GET', '/api/v1/assets/PRESS-001');
    ok(r.body.status === 'offline', 'a machine silent for > offline_after_seconds is offline', r.body.status);

    const fatal = e.warnings.filter((w) => w.fatal || (w.error && !/getaddrinfo/.test(w.error)));
    ok(fatal.length === 0, 'no unexpected errors raised by any node', fatal);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
