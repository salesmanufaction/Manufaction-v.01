// Reads the rules the customer can edit (mf.settings and mf.reason_codes) into global context
// as  global.get('cfg') . Runs every 10 seconds, so a change in Studio is live within 10 s.
const db = global.get('db');
const lib = global.get('lib');
if (!lib) return null;                                   // library not started yet

const s = await db.query('SELECT key, value FROM mf.settings');
const r = await db.query('SELECT code, description, asset_type, severity, assigned_to FROM mf.reason_codes WHERE active');

const cfg = {};
s.rows.forEach((row) => { cfg[row.key] = row.value; });
cfg.reasons = {};
r.rows.forEach((row) => { cfg.reasons[row.code] = row; });
global.set('cfg', cfg);

node.status({ text: `${s.rows.length} settings, ${r.rows.length} reason codes @ ${new Date().toLocaleTimeString()}` });
return null;
