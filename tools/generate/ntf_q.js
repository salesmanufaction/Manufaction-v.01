// Every 5 s: find alerts that have not been delivered yet.
// Delivery is off until MF_NOTIFY_WEBHOOK_URL is set in .env.
// A failed send is retried up to 5 times, 15 s apart; anything older than 15 minutes is dropped,
// so switching delivery on never replays old alerts.
const db = global.get('db');
if (!env.get('MF_NOTIFY_WEBHOOK_URL')) {
    node.status({ fill: 'grey', shape: 'ring', text: 'disabled (no MF_NOTIFY_WEBHOOK_URL)' });
    return null;
}
node.status({ fill: 'green', shape: 'dot', text: 'enabled' });

const rows = (await db.query(
    `SELECT n.id, n.kind, n.severity, n.title, n.message, n.created_at,
            s.site_code, a.asset_code,
            r.request_number AS work_request, r.reason_code, r.description AS wr_description, r.assigned_to
       FROM mf.notifications n
       LEFT JOIN mf.assets a ON a.id = n.asset_id
       LEFT JOIN mf.sites s ON s.id = a.site_id
       LEFT JOIN mf.maintenance_requests r ON r.downtime_event_id = n.downtime_event_id
      WHERE NOT n.seeded
        AND n.delivered_at IS NULL
        AND n.delivery_attempts < 5
        AND n.created_at > NOW() - INTERVAL '15 minutes'
        AND (n.last_attempt_at IS NULL OR n.last_attempt_at < NOW() - INTERVAL '15 seconds')
        AND NOT (n.kind = 'downtime_alert' AND r.id IS NOT NULL)   -- the work-request message covers it
      ORDER BY n.created_at, n.id
      LIMIT 10`)).rows;
if (!rows.length) return null;

// Wording of each message. Change the text here to change what people receive.
const text = (r) => {
    switch (r.kind) {
        case 'maintenance_dispatched':
            return `FAULT: ${r.asset_code} - ${r.wr_description || 'no reason reported'}. Work request ${r.work_request} sent to ${r.assigned_to}.`;
        case 'downtime_alert':
            return `STOPPED: ${r.asset_code} has stopped (${r.message || 'no reason reported'}).`;
        case 'recovered':
            return `BACK IN PRODUCTION: ${r.asset_code} - ${r.message || ''}.`;
        default:
            return 'TEST: Manufaction notifications are working.';
    }
};
return [rows.map((r) => Object.assign({}, r, { text: text(r) })).map((r) => ({ payload: r }))];
