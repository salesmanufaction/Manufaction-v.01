// A machine came back. Close its work request and tell the plant it is producing again.
const db = global.get('db');
const lib = global.get('lib');
const cfg = lib.cfg();
const d = msg.payload;                    // the downtime row, now with ended_at and duration_seconds
const a = msg.ctx.asset;

await db.tx(async (c) => {
    await c.query(
        `UPDATE mf.maintenance_requests SET status = 'closed', closed_at = $2
          WHERE downtime_event_id = $1 AND status = 'open'`, [d.id, d.ended_at]);
    if (cfg.alert_statuses.includes(d.status)) {
        await c.query(
            `INSERT INTO mf.notifications (kind, severity, asset_id, downtime_event_id, title, message, created_at)
             VALUES ('recovered', 'success', $1, $2, $3, $4, $5)`,
            [a.id, d.id, `${a.asset_code} back in production`,
             `Down for ${lib.fmtDuration(d.duration_seconds)}`, d.ended_at]);
    }
});
node.status({ fill: 'green', shape: 'dot', text: `${a.asset_code} recovered` });
return null;
