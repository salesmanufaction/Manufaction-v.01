// Store signal readings: one row per signal in mf.telemetry, and the latest value on mf.asset_signals.
const db = global.get('db');
const lib = global.get('lib');
const { site, asset } = msg.mf;
const body = msg.body;

const a = await lib.findAsset(site, asset);
if (!a) return [null, { topic: msg.topic, payload: { error: 'unknown_asset', site, asset } }];
if (!body.signals || typeof body.signals !== 'object' || Array.isArray(body.signals)) {
    return [null, { topic: msg.topic, payload: { error: 'signals_object_required' } }];
}
const ts = lib.parseTs(body.timestamp) || new Date();

await db.tx(async (c) => {
    await c.query('UPDATE mf.assets SET last_seen_at = GREATEST(COALESCE(last_seen_at, $2::timestamptz), $2::timestamptz) WHERE id = $1', [a.id, ts]);
    for (const [name, value] of Object.entries(body.signals)) {
        if (value === null || value === undefined) continue;
        const isNum = typeof value === 'number' && Number.isFinite(value);
        const num = isNum ? value : null;
        const txt = isNum ? null : (typeof value === 'object' ? JSON.stringify(value) : String(value));
        const unit = body.units && body.units[name] != null ? String(body.units[name]) : null;
        const sig = await c.query(
            `INSERT INTO mf.asset_signals (asset_id, signal_name, data_type, unit)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (asset_id, signal_name) DO UPDATE SET unit = COALESCE(EXCLUDED.unit, mf.asset_signals.unit)
             RETURNING id`, [a.id, name, isNum ? 'numeric' : 'text', unit]);
        const sid = sig.rows[0].id;
        await c.query(
            `INSERT INTO mf.telemetry (asset_id, signal_id, value_numeric, value_text, recorded_at)
             VALUES ($1, $2, $3, $4, $5)`, [a.id, sid, num, txt, ts]);
        await c.query(
            `UPDATE mf.asset_signals SET last_value_numeric = $2, last_value_text = $3, last_recorded_at = $4
              WHERE id = $1`, [sid, num, txt, ts]);
    }
});
return null;
