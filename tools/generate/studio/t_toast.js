// Pops up a notification on every open dashboard whenever a new alert is written.
// First run only remembers where we are, so a restart never replays old alerts.
if (flow.get('last') === undefined) {
    msg.query = 'SELECT COALESCE(max(id), 0)::int AS last FROM mf.notifications';
    msg.params = [];
    msg.init = true;
    return msg;
}
msg.query = `SELECT n.id, n.kind, n.severity, n.title, n.message, a.asset_code
               FROM mf.notifications n LEFT JOIN mf.assets a ON a.id = n.asset_id
              WHERE n.id > $1 AND NOT n.seeded ORDER BY n.id`;
msg.params = [flow.get('last')];
return msg;
