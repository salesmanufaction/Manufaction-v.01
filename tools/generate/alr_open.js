// A machine went down. Decide what the plant needs to know and who must act:
//   * a dashboard alert              (statuses listed in the "alert_statuses" setting)
//   * a maintenance work request     (statuses listed in "work_request_statuses")
// Who gets the work request, and how serious it is, comes from the reason code catalogue.
const db = global.get('db');
const lib = global.get('lib');
const cfg = lib.cfg();
const d = msg.payload;                    // the new mf.downtime_events row
const a = msg.ctx.asset;                  // the machine

const reason = lib.reason(d.reason_code);
const what = d.reason_description || (reason && reason.description) || d.reason_code || 'No reason reported';
const severity = reason && reason.severity ? reason.severity : 'critical';
const assignee = (reason && reason.assigned_to) || cfg.default_assignee;
let workRequest = null;

await db.tx(async (c) => {
    if (!d.reason_description && what !== 'No reason reported') {
        await c.query('UPDATE mf.downtime_events SET reason_description = $2 WHERE id = $1', [d.id, what]);
    }
    if (cfg.alert_statuses.includes(d.status)) {
        await c.query(
            `INSERT INTO mf.notifications (kind, severity, asset_id, downtime_event_id, title, message, created_at)
             VALUES ('downtime_alert', $1, $2, $3, $4, $5, $6)`,
            [severity, a.id, d.id, `${a.asset_code} ${d.status}`, what, d.started_at]);
    }
    if (cfg.work_request_statuses.includes(d.status)) {
        // WR-YYMMDD-NNN : date in the plant's own time zone, running number from a database sequence
        const n = (await c.query(
            `SELECT 'WR-' || to_char($1::timestamptz AT TIME ZONE $2, 'YYMMDD') || '-'
                    || lpad(nextval('mf.work_request_seq')::text, 3, '0') AS number`,
            [d.started_at, a.timezone])).rows[0].number;
        workRequest = n;
        await c.query(
            `INSERT INTO mf.maintenance_requests
                    (request_number, asset_id, downtime_event_id, reason_code, description, assigned_to, opened_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [n, a.id, d.id, d.reason_code, what, assignee, d.started_at]);
        await c.query(
            `INSERT INTO mf.notifications (kind, severity, asset_id, downtime_event_id, title, message, created_at)
             VALUES ('maintenance_dispatched', 'info', $1, $2, 'Maintenance notified', $3,
                     $4::timestamptz + interval '1 second')`,
            [a.id, d.id, `${n} sent to ${assignee} for ${a.asset_code}`, d.started_at]);
    }
});

node.status({ fill: 'red', shape: 'dot', text: `${a.asset_code} ${d.status}${workRequest ? ' ' + workRequest : ''}` });
return null;
