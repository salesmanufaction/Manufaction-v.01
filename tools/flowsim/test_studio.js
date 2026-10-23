// Runs the STUDIO flows (studio/data/flows.json) against a real PostgreSQL as the restricted mf_studio user.
//   node tools/flowsim/test_studio.js        (database needs 001, 002 and 003_roles applied)
const fs = require('fs'), path = require('path');
const { makeDb } = require('./pgshim');
const { Engine } = require('./engine');
const root = path.join(__dirname, '..', '..');
const admin = process.env.PGCONN || '-h /tmp -p 54335 -U postgres -d manufaction';
const studio = process.env.PGCONN_STUDIO || '-h /tmp -p 54335 -U mf_studio -d manufaction';
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

(async () => {
    const a = makeDb(admin);          // seeds data like the core engine would
    await a.query(`TRUNCATE mf.telemetry, mf.asset_signals, mf.notifications, mf.maintenance_requests, mf.quality_events,
        mf.production_events, mf.downtime_events, mf.production_orders, demo_erp.production_receipts RESTART IDENTITY`);
    await a.query(`DELETE FROM mf.assets WHERE asset_code = 'PRESS-009'`);
    await a.query(`UPDATE mf.assets SET status='offline', last_seen_at=NULL`);
    await a.query(`UPDATE mf.assets SET status='running', last_seen_at=now() WHERE asset_code='PRESS-001'`);
    await a.query(`UPDATE mf.assets SET status='faulted', last_seen_at=now() WHERE asset_code='CNC-001'`);
    await a.query(`INSERT INTO mf.asset_signals (asset_id, signal_name, last_value_numeric, unit, last_recorded_at)
                   SELECT id,'temperature',185.2,'degF',now() FROM mf.assets WHERE asset_code='PRESS-001'`).catch(async (e) => console.log('signal seed:', e.message));
    await a.query(`INSERT INTO mf.production_orders (site_id, order_number, asset_id, part_number, target_quantity, completed_quantity, status, released_at)
                   SELECT site_id, 'PO-T1', id, 'BRKT-100', 40, 12, 'running', now() FROM mf.assets WHERE asset_code='PRESS-001'`).catch((e) => console.log('order seed:', e.message));
    await a.query(`INSERT INTO mf.downtime_events (asset_id, status, reason_code, reason_description, started_at)
                   SELECT id,'faulted','TOOL_BREAK','Tool breakage detected', now() - interval '5 minutes' FROM mf.assets WHERE asset_code='CNC-001'`).catch((e) => console.log('dt seed:', e.message));
    await a.query(`INSERT INTO mf.notifications (kind, severity, title, message, seeded) VALUES ('downtime_alert','critical','CNC 001 is down','Tool breakage', false)`).catch((e) => console.log('ntf seed:', e.message));

    const db = makeDb(studio);        // what the Studio container really connects as
    const flows = JSON.parse(fs.readFileSync(path.join(root, 'studio', 'data', 'flows.json'), 'utf8'));
    const e = new Engine(flows, { db, env: {}, globals: {} });
    await e.init();
    const out = (id) => (e.ui.get(id) || []).slice(-1)[0];

    console.log('every polled panel runs its SQL as mf_studio');
    for (const k of ['kpis', 'alerts', 'machines', 'orders', 'downtime', 'workrequests', 'receipts', 'feed', 'settings', 'reasons', 'machinelist']) {
        await e.fire(k + '_i');
        ok(!!out(k + '_w'), `panel "${k}" produced output`, e.warnings.slice(-1));
    }
    const kp = out('kpis_w').payload;
    ok(kp.total === 6 && kp.running === 1 && kp.down_now === 1, 'KPIs: 6 machines, 1 running, 1 down', kp);
    const al = out('alerts_w').payload;
    ok(al.length === 1 && al[0].asset_code === 'CNC-001' && /Tool/.test(al[0].reason), 'alert banner lists CNC-001', al);
    const mc = out('machines_w').payload;
    const p1 = mc.find((m) => m.asset_code === 'PRESS-001'), c1 = mc.find((m) => m.asset_code === 'CNC-001');
    ok(mc.length === 6 && p1.status === 'running' && p1.order && p1.order.completed === 12, 'machine card has status + active order', p1);
    ok(c1.downtime && c1.downtime.reason === 'Tool breakage detected', 'faulted card shows downtime reason', c1);
    ok(Array.isArray(out('orders_w').payload) && out('orders_w').payload[0].Order === 'PO-T1', 'orders table rows are friendly', out('orders_w').payload);
    ok(out('feed_w').payload[0].Notice === 'CNC 001 is down', 'notices table', out('feed_w').payload);
    ok(out('settings_w').payload.some((s) => s.Setting === 'yield_target_pct'), 'settings table');
    ok(out('reasons_w').payload.length === 9, 'fault catalogue has 9 codes');

    console.log('pop-up alerts');
    await e.fire('toast_i');                       // first run: remembers position, shows nothing
    ok(!e.ui.get('n_toast'), 'restart does not replay old alerts');
    await a.query(`INSERT INTO mf.notifications (kind, severity, title, message, seeded) VALUES ('downtime_alert','warning','PRESS 002 stopped','Jam', false)`);
    await e.fire('toast_i');
    const t = out('n_toast');
    ok(t && /PRESS 002 stopped/.test(t.payload) && t.color === '#d97706', 'new alert becomes a coloured pop-up', t);

    console.log('settings form');
    await e.deliver('fs_f', { payload: { key: 'yield_target_pct', value: '97' } }); await e.settle();
    ok(JSON.stringify((await a.query(`SELECT value FROM mf.settings WHERE key='yield_target_pct'`)).rows[0].value) === '97', 'number saved as a number');
    ok(/now 97/.test(out('fs_n').payload) && out('fs_n').color === '#16a34a', 'success pop-up', out('fs_n'));
    await e.deliver('fs_f', { payload: { key: 'alert_statuses', value: '["faulted"]' } }); await e.settle();
    ok(JSON.stringify((await a.query(`SELECT value FROM mf.settings WHERE key='alert_statuses'`)).rows[0].value) === '["faulted"]', 'list saved as a list');
    await e.deliver('fs_f', { payload: { key: 'default_assignee', value: 'Night shift' } }); await e.settle();
    ok((await a.query(`SELECT value #>> '{}' AS v FROM mf.settings WHERE key='default_assignee'`)).rows[0].v === 'Night shift', 'plain words saved as text');
    await e.deliver('fs_f', { payload: { key: 'no_such_key', value: '1' } }); await e.settle();
    ok(/no setting called/.test(out('fs_n').payload) && out('fs_n').color === '#d97706', 'unknown setting name is refused politely', out('fs_n'));
    await e.deliver('fs_f', { payload: { key: '', value: '' } }); await e.settle();
    ok(/needed/.test(out('fs_n').payload), 'empty form is refused');
    await a.query(`UPDATE mf.settings SET value='95' WHERE key='yield_target_pct'`);
    await a.query(`UPDATE mf.settings SET value='["faulted","stopped"]' WHERE key='alert_statuses'`);
    await a.query(`UPDATE mf.settings SET value='"Maintenance on-call"' WHERE key='default_assignee'`);

    console.log('fault code form');
    await e.deliver('fr_f', { payload: { code: 'door ajar', description: 'Safety door open', asset_type: 'press', severity: 'warning', assigned_to: 'Safety lead', active: true } }); await e.settle();
    let rc = (await a.query(`SELECT * FROM mf.reason_codes WHERE code='DOOR_AJAR'`)).rows[0];
    ok(rc && rc.severity === 'warning' && rc.assigned_to === 'Safety lead' && rc.asset_type === 'press', 'new fault code stored, code normalised', rc);
    await e.deliver('fr_f', { payload: { code: 'DOOR_AJAR', description: 'Safety door open', asset_type: '', severity: 'critical', assigned_to: '', active: false } }); await e.settle();
    rc = (await a.query(`SELECT * FROM mf.reason_codes WHERE code='DOOR_AJAR'`)).rows[0];
    ok(rc.severity === 'critical' && rc.asset_type === null && rc.assigned_to === null && rc.active === false, 'same code updates in place', rc);
    await e.deliver('fr_f', { payload: { code: 'X', description: 'x', severity: 'bad' } }); await e.settle();
    ok(/Severity must be/.test(out('fr_n').payload), 'bad severity refused');
    await a.query(`DELETE FROM mf.reason_codes WHERE code='DOOR_AJAR'`);

    console.log('machine form');
    await e.deliver('fm_f', { payload: { code: 'press-009', name: 'Press 009', area: 'Forging', type: 'Press', part: 'BRKT-900', cycle: '12.5' } }); await e.settle();
    let m = (await a.query(`SELECT a.asset_code, a.name, a.asset_type, a.ideal_cycle_seconds, ar.name AS area FROM mf.assets a JOIN mf.areas ar ON ar.id=a.area_id WHERE asset_code='PRESS-009'`)).rows[0];
    ok(m && m.area === 'Forging' && m.asset_type === 'press' && m.ideal_cycle_seconds === 12.5, 'new machine + new area created', m);
    await e.deliver('fm_f', { payload: { code: 'PRESS-009', name: 'Press 9 (renamed)', area: 'Stamping', type: 'press', part: '', cycle: '' } }); await e.settle();
    m = (await a.query(`SELECT a.name, ar.name AS area FROM mf.assets a JOIN mf.areas ar ON ar.id=a.area_id WHERE asset_code='PRESS-009'`)).rows[0];
    ok(m.name === 'Press 9 (renamed)' && m.area === 'Stamping', 'same code updates in place', m);
    await e.deliver('fm_f', { payload: { code: 'bad code!', name: 'x', area: 'x', type: 'x' } }); await e.settle();
    ok(/capitals/.test(out('fm_n').payload), 'bad machine code refused');
    await e.fire('machinelist_i');
    ok(out('machinelist_w').payload.length === 7, 'machine table refreshed with 7 rows', out('machinelist_w').payload.length);

    console.log('least privilege: Studio cannot touch production data');
    for (const [name, sql] of [['update an order', `UPDATE mf.production_orders SET completed_quantity = 999`],
                               ['change machine status', `UPDATE mf.assets SET status='running'`],
                               ['delete downtime', `DELETE FROM mf.downtime_events`],
                               ['write a notification', `INSERT INTO mf.notifications (kind,severity,title,message) VALUES ('x','info','x','x')`]]) {
        let denied = false; try { await db.query(sql); } catch (err) { denied = /permission denied/i.test(err.message); }
        ok(denied, `blocked: ${name}`);
    }
    await a.query(`DELETE FROM mf.assets WHERE asset_code='PRESS-009'`);
    await a.query(`DELETE FROM mf.areas WHERE name='Forging'`);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
