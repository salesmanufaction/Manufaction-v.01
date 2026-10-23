// Nightly housekeeping: delete raw telemetry older than the "telemetry_keep_days" setting.
const db = global.get('db');
const lib = global.get('lib');
const days = Number(lib.cfg().telemetry_keep_days) || 7;
const r = await db.query(`DELETE FROM mf.telemetry WHERE recorded_at < NOW() - make_interval(days => $1::int)`, [days]);
node.status({ text: `purged ${r.rowCount} rows (older than ${days} days) @ ${new Date().toLocaleTimeString()}` });
return null;
