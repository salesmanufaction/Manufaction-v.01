// A machine reports something that happened: online, order_started, cycle_complete, fault_cleared ...
// This is where parts are counted against the active order and where an order is completed.
// Outputs: 1 = command to the machine, 2 = production receipt for the ERP, 3 = rejected.
const db = global.get('db');
const lib = global.get('lib');
const { site, asset } = msg.mf;
const body = msg.body;

const ev = String(body.event_type || '').toLowerCase();
if (!ev) return [null, null, { topic: msg.topic, payload: { error: 'event_type_required' } }];
const a = await lib.findAsset(site, asset);
if (!a) return [null, null, { topic: msg.topic, payload: { error: 'unknown_asset', site, asset } }];

const ts = lib.parseTs(body.timestamp) || new Date();
// quantity must be a whole number from 1 to 1000; anything else counts as 1
const q = Number(body.quantity);
const qty = Number.isInteger(q) && q >= 1 && q <= 1000 ? q : 1;

let completed = null;
await db.tx(async (c) => {
    await c.query('UPDATE mf.assets SET last_seen_at = GREATEST(COALESCE(last_seen_at, $2::timestamptz), $2::timestamptz) WHERE id = $1', [a.id, ts]);

    // a device that (re)started has lost its work: hand running orders back to be re-sent
    if (ev === 'online') {
        await c.query(`UPDATE mf.production_orders SET status = 'released' WHERE asset_id = $1 AND status = 'running'`, [a.id]);
    }

    let order;
    if (ev === 'order_started') {
        order = (await c.query(
            `UPDATE mf.production_orders SET status = 'running', started_at = COALESCE(started_at, $3::timestamptz)
              WHERE asset_id = $1 AND order_number = $2 AND status IN ('released','running') RETURNING *`,
            [a.id, body.order_number || null, ts])).rows[0];
    } else {
        order = (await c.query(
            `SELECT * FROM mf.production_orders WHERE asset_id = $1 AND status = 'running'
              ORDER BY started_at LIMIT 1`, [a.id])).rows[0];
    }

    await c.query(
        `INSERT INTO mf.production_events (asset_id, production_order_id, event_type, quantity, event_time, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [a.id, order ? order.id : null, ev, qty, ts, JSON.stringify(body)]);

    if (ev === 'cycle_complete') {
        let result = String(body.quality_result || 'good').toLowerCase();
        if (!['good', 'scrap', 'rework'].includes(result)) result = 'good';
        await c.query(
            `INSERT INTO mf.quality_events (asset_id, production_order_id, part_number, result, defect_code, event_time)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [a.id, order ? order.id : null,
             body.part_number || (order && order.part_number) || a.default_part_number,
             result, body.defect_code || null, ts]);

        if (order) {
            const upd = (await c.query(
                `UPDATE mf.production_orders
                    SET completed_quantity = completed_quantity + $2, scrap_quantity = scrap_quantity + $3
                  WHERE id = $1 RETURNING *`,
                [order.id, result === 'good' ? qty : 0, result === 'good' ? 0 : qty])).rows[0];
            if (upd.completed_quantity >= upd.target_quantity) {
                // "AND status = 'running'" makes sure an order is completed, and its receipt sent, only once
                const done = (await c.query(
                    `UPDATE mf.production_orders SET status = 'complete', completed_at = $2
                      WHERE id = $1 AND status = 'running' RETURNING *`, [order.id, ts])).rows[0];
                if (done) {
                    completed = {
                        order_number: done.order_number, part_number: done.part_number,
                        good_quantity: done.completed_quantity, scrap_quantity: done.scrap_quantity,
                        completed_at: done.completed_at, site, asset,
                    };
                }
            }
        }
    }
});

if (!completed) return null;

node.status({ fill: 'green', shape: 'dot', text: `${completed.order_number} complete` });
// 1) tell the machine the order is finished
const cmd = {
    topic: `mf/v1/site/${site}/asset/${asset}/command`,
    payload: { command: 'complete_order', order_number: completed.order_number },
};
// 2) send the production receipt back to the (demo) ERP
const receipt = {
    method: 'POST',
    url: 'http://127.0.0.1:1880/demo-erp/receipts',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.get('MF_API_TOKEN') },
    payload: completed,
};
return [cmd, receipt, null];
