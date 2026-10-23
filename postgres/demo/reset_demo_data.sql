-- Wipes OPERATIONAL data (orders, events, downtime, telemetry, alerts, receipts) and puts every
-- machine back to "offline" so you can record a clean take. Master data (site, areas, assets)
-- is kept. Run through ./scripts/demo_reset.sh, which also restarts the simulator.
TRUNCATE mf.telemetry, mf.asset_signals, mf.notifications, mf.maintenance_requests,
         mf.quality_events, mf.production_events, mf.downtime_events, mf.production_orders,
         demo_erp.production_receipts RESTART IDENTITY;
ALTER SEQUENCE mf.work_request_seq RESTART;
UPDATE mf.assets SET status = 'offline', status_changed_at = NULL, last_seen_at = NULL;
