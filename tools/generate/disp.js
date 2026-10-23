// Re-send start_order to machines that have a released order but have not acknowledged it yet.
// (The machine confirms with an order_started event; until then the order stays "released".)
const db = global.get('db');
const lib = global.get('lib');
const cfg = lib.cfg();

// the tick runs every 5 s; only act as often as the "dispatch_retry_seconds" setting says
const last = context.get('last') || 0;
if (Date.now() - last < cfg.dispatch_retry_seconds * 1000 - 500) return null;
context.set('last', Date.now());

const rows = (await db.query(
    `SELECT s.site_code AS site, a.asset_code AS asset, o.order_number, o.part_number, o.target_quantity,
            a.status, a.last_seen_at
       FROM mf.production_orders o
       JOIN mf.assets a ON a.id = o.asset_id
       JOIN mf.sites s ON s.id = o.site_id
      WHERE o.status = 'released'`)).rows
    .filter((r) => lib.effectiveStatus(r.status, r.last_seen_at) !== 'offline');

node.status({ text: `${rows.length} dispatched @ ${new Date().toLocaleTimeString()}` });
return [rows.map((r) => lib.startCommand(r))];
