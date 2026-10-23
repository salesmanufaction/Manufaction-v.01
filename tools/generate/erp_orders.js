// DEMO ERP: stands in for a customer ERP. Every 20 s, any machine that is online and has no open
// order gets a new work order, released through the public REST API (the same call a real ERP would make).
// Order size depends on the machine type. Switch off with DEMO_ERP_ENABLED=false in .env.
if (env.get('DEMO_ERP_ENABLED') === 'false') return null;
const db = global.get('db');
const lib = global.get('lib');

const SIZE = { press: [30, 60], cnc: [8, 16], assembly: [12, 24] };
const rows = (await db.query(
    `SELECT s.site_code, a.asset_code, a.asset_type, a.default_part_number AS part_number, a.status, a.last_seen_at
       FROM mf.assets a JOIN mf.sites s ON s.id = a.site_id
      WHERE NOT EXISTS (SELECT 1 FROM mf.production_orders o
                         WHERE o.asset_id = a.id AND o.status IN ('released','running'))`)).rows
    .filter((r) => lib.effectiveStatus(r.status, r.last_seen_at) !== 'offline' && r.part_number);

const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
return [rows.map((a) => {
    const [lo, hi] = SIZE[a.asset_type] || [10, 20];
    return {
        method: 'POST', url: 'http://127.0.0.1:1880/api/v1/production-orders',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.get('MF_API_TOKEN') },
        payload: {
            site: a.site_code, asset: a.asset_code, part_number: a.part_number,
            order_number: `MO-${stamp}-${Math.floor(Math.random() * 9000 + 1000)}`,
            target_quantity: Math.floor(Math.random() * (hi - lo + 1)) + lo,
            source_system: 'DEMO-ERP',
        },
    };
})];
