// LIBRARY: shared helper functions used by the other flows.
// This node has no input. It runs once when the flows start ("On Start" tab) and stores the helpers
// in global context as  global.get('lib'). Other function nodes call e.g. lib.findAsset(...).
const db = global.get('db');
const lib = {};

// Rules and tuning values. The real values live in the mf.settings table (edited by the customer in
// Studio) and are reloaded every 10 s by the "Load settings" node. These are the fall-backs.
lib.defaults = {
    plant_name: 'Manufaction Demo Factory',
    offline_after_seconds: 30,
    downtime_statuses: ['faulted', 'stopped', 'maintenance'],
    alert_statuses: ['faulted', 'stopped'],
    work_request_statuses: ['faulted'],
    default_assignee: 'Maintenance on-call',
    yield_target_pct: 95,
    telemetry_keep_days: 7,
    dispatch_retry_seconds: 15,
    reasons: {},
};
lib.cfg = () => Object.assign({}, lib.defaults, global.get('cfg') || {});

lib.STATUSES = ['running', 'idle', 'stopped', 'faulted', 'maintenance', 'offline'];

lib.parseTs = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

// A machine that has been silent for longer than offline_after_seconds is shown as offline.
lib.effectiveStatus = (status, lastSeen) => {
    if (!lastSeen) return 'offline';
    const silentMs = Date.now() - new Date(lastSeen).getTime();
    return silentMs > lib.cfg().offline_after_seconds * 1000 ? 'offline' : status;
};

lib.fmtDuration = (s) => {
    if (s === null || s === undefined) return 'unknown time';
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
    return Math.floor(s / 3600) + 'h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm';
};

lib.findAsset = async (site, asset, client) => {
    const q = client || db;
    const r = await q.query(
        `SELECT a.*, s.site_code, s.timezone
           FROM mf.assets a JOIN mf.sites s ON s.id = a.site_id
          WHERE s.site_code = $1 AND a.asset_code = $2`, [site, asset]);
    return r.rows[0] || null;
};

// Reason catalogue lookup (a specific code for this machine type wins over a generic one).
lib.reason = (code) => (code && lib.cfg().reasons[code]) || null;

lib.orderView = (o) => ({
    order_number: o.order_number,
    site: o.site_code,
    asset: o.asset_code,
    part_number: o.part_number,
    target_quantity: o.target_quantity,
    completed_quantity: o.completed_quantity,
    scrap_quantity: o.scrap_quantity,
    percent_complete: Math.round(1000 * o.completed_quantity / o.target_quantity) / 10,
    status: o.status,
    source_system: o.source_system,
    released_at: o.released_at,
    started_at: o.started_at,
    completed_at: o.completed_at,
});

lib.ORDER_SQL = `SELECT o.*, s.site_code, a.asset_code
                   FROM mf.production_orders o
                   JOIN mf.sites s ON s.id = o.site_id
                   LEFT JOIN mf.assets a ON a.id = o.asset_id`;

// Assets in the shape the REST API returns: live status, latest signals, active order, open downtime.
lib.assetViews = async (site, assetCode) => {
    const assets = (await db.query(
        `SELECT a.id, s.site_code, a.asset_code, a.name, a.asset_type, ar.name AS area,
                a.status, a.status_changed_at, a.last_seen_at
           FROM mf.assets a
           JOIN mf.sites s ON s.id = a.site_id
           LEFT JOIN mf.areas ar ON ar.id = a.area_id
          WHERE ($1::text IS NULL OR s.site_code = $1) AND ($2::text IS NULL OR a.asset_code = $2)
          ORDER BY a.asset_code`, [site || null, assetCode || null])).rows;
    if (!assets.length) return [];
    const ids = assets.map((a) => a.id);

    const signals = (await db.query(
        `SELECT asset_id, signal_name, last_value_numeric, last_value_text, unit, last_recorded_at
           FROM mf.asset_signals WHERE asset_id = ANY($1::uuid[]) ORDER BY signal_name`, [ids])).rows;
    const orders = (await db.query(
        `${lib.ORDER_SQL}
          WHERE o.asset_id = ANY($1::uuid[]) AND o.status IN ('released','running')
          ORDER BY o.released_at`, [ids])).rows;
    const downtime = (await db.query(
        `SELECT d.*, (SELECT r.request_number FROM mf.maintenance_requests r
                       WHERE r.downtime_event_id = d.id LIMIT 1) AS work_request
           FROM mf.downtime_events d
          WHERE d.asset_id = ANY($1::uuid[]) AND d.ended_at IS NULL`, [ids])).rows;

    return assets.map((a) => {
        const sig = {};
        signals.filter((s) => s.asset_id === a.id).forEach((s) => {
            sig[s.signal_name] = {
                value: s.last_value_numeric !== null ? s.last_value_numeric : s.last_value_text,
                unit: s.unit,
                at: s.last_recorded_at,
            };
        });
        const o = orders.find((x) => x.asset_id === a.id);
        const d = downtime.find((x) => x.asset_id === a.id);
        return {
            site: a.site_code,
            asset: a.asset_code,
            name: a.name,
            asset_type: a.asset_type,
            area: a.area,
            status: lib.effectiveStatus(a.status, a.last_seen_at),
            status_changed_at: a.status_changed_at,
            last_seen_at: a.last_seen_at,
            signals: sig,
            active_order: o ? lib.orderView(o) : null,
            open_downtime: d ? {
                status: d.status, reason_code: d.reason_code, reason_description: d.reason_description,
                started_at: d.started_at, work_request: d.work_request,
            } : null,
        };
    });
};

// Order creation rules: the asset must exist, and a machine may have only one open order.
// (The database also enforces "one open order per machine"; we turn that into a clean 409.)
lib.createOrder = async (o) => {
    const a = await lib.findAsset(o.site, o.asset);
    if (!a) return { status_code: 404, error: 'unknown_asset' };
    const part = o.part_number || a.default_part_number;
    if (!part) return { status_code: 400, error: 'bad_request', detail: 'part_number is required for this asset' };
    try {
        const r = await db.query(
            `INSERT INTO mf.production_orders
                    (site_id, asset_id, order_number, part_number, target_quantity, source_system)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [a.site_id, a.id, o.order_number, part, o.target_quantity, o.source_system || 'API']);
        return {
            status_code: 201,
            order: lib.orderView(Object.assign({}, r.rows[0], { site_code: a.site_code, asset_code: a.asset_code })),
        };
    } catch (e) {
        if (e.code === '23505') {
            return { status_code: 409, error: 'duplicate_order_or_asset_busy',
                     detail: 'order_number already exists, or the asset already has an open order' };
        }
        throw e;
    }
};

// start_order command for a machine (used by the API, the dispatcher and anything you add).
lib.startCommand = (o) => ({
    topic: `mf/v1/site/${o.site}/asset/${o.asset}/command`,
    payload: { command: 'start_order', order_number: o.order_number,
               part_number: o.part_number, target_quantity: o.target_quantity },
});

global.set('lib', lib);
node.status({ fill: 'green', shape: 'dot', text: 'library ready' });
