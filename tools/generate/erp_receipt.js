// DEMO ERP: receives the production receipt that Manufaction sends when an order completes.
const db = global.get('db');
const lib = global.get('lib');
if (!global.get('mfAuthorize')(msg.req)) {
    msg.statusCode = 401; msg.payload = { error: 'unauthorized' };
    return msg;
}
const p = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
if (!p.order_number) { msg.statusCode = 400; msg.payload = { error: 'bad_request', detail: 'order_number required' }; return msg; }
const num = (v) => (Number.isInteger(Number(v)) ? Number(v) : null);
const r = await db.query(
    `INSERT INTO demo_erp.production_receipts
            (order_number, part_number, good_quantity, scrap_quantity, completed_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [String(p.order_number), p.part_number || null, num(p.good_quantity), num(p.scrap_quantity),
     lib.parseTs(p.completed_at), JSON.stringify(p)]);
msg.statusCode = 201;
msg.payload = { ok: true, receipt_id: r.rows[0].id };
node.status({ fill: 'blue', shape: 'dot', text: `receipt ${r.rows[0].id}` });
return msg;
