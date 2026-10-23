// A machine reports its state. Keep mf.assets current and open or close downtime.
// Outputs: 1 = downtime opened (goes to "04 Alerts & Maintenance"), 2 = downtime closed, 3 = rejected.
const db = global.get('db');
const lib = global.get('lib');
const { site, asset } = msg.mf;
const body = msg.body;

const status = String(body.status || '').toLowerCase();
if (!lib.STATUSES.includes(status)) {
    return [null, null, { topic: msg.topic, payload: { error: 'invalid_status', status: body.status } }];
}
const a = await lib.findAsset(site, asset);
if (!a) return [null, null, { topic: msg.topic, payload: { error: 'unknown_asset', site, asset } }];

const ts = lib.parseTs(body.timestamp) || new Date();
const cfg = lib.cfg();
const isDown = cfg.downtime_statuses.includes(status);

// reason text: what the machine said, else the catalogue entry for its reason code
const code = body.reason_code ? String(body.reason_code) : null;
const catalogue = lib.reason(code);
const reasonText = body.reason_description ? String(body.reason_description)
                 : (catalogue ? catalogue.description : null);

let opened = null, closed = null;
await db.tx(async (c) => {
    const cur = (await c.query('SELECT status FROM mf.assets WHERE id = $1 FOR UPDATE', [a.id])).rows[0];
    await c.query('UPDATE mf.assets SET last_seen_at = GREATEST(COALESCE(last_seen_at, $2::timestamptz), $2::timestamptz) WHERE id = $1', [a.id, ts]);
    if (cur.status !== status) {
        await c.query('UPDATE mf.assets SET status = $2, status_changed_at = $3 WHERE id = $1', [a.id, status, ts]);
    }
    const open = (await c.query('SELECT * FROM mf.downtime_events WHERE asset_id = $1 AND ended_at IS NULL', [a.id])).rows[0];
    let stillOpen = open;
    // close the open downtime if the machine recovered or moved to a different downtime state
    if (open && (!isDown || open.status !== status)) {
        closed = (await c.query(
            `UPDATE mf.downtime_events
                SET ended_at = $2::timestamptz,
                    duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - started_at)))::int
              WHERE id = $1 RETURNING *`, [open.id, ts])).rows[0];
        stillOpen = null;
    }
    if (isDown && !stillOpen) {
        opened = (await c.query(
            `INSERT INTO mf.downtime_events (asset_id, status, reason_code, reason_description, started_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`, [a.id, status, code, reasonText, ts])).rows[0];
    }
});

const ctx = { asset: a };
return [
    opened ? { topic: msg.topic, payload: opened, ctx } : null,
    closed ? { topic: msg.topic, payload: closed, ctx } : null,
    null,
];
