-- Manufaction v0.1 — ingestion and API functions
-- Node-RED routes and validates; these functions own the canonical write/read logic
-- so it is version-controlled, testable with psql, and identical for MQTT and REST input.

SET search_path = mf, public;

-- Parse a timestamp safely; fall back to now() for missing/invalid values.
CREATE OR REPLACE FUNCTION mf.try_ts(p TEXT) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p IS NULL OR p = '' THEN RETURN NULL; END IF;
    RETURN p::timestamptz;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

-- Status that the UI should show: anything silent for 30s is offline.
CREATE OR REPLACE FUNCTION mf.effective_status(p_status TEXT, p_last_seen TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_last_seen IS NULL OR p_last_seen < NOW() - INTERVAL '30 seconds'
                THEN 'offline' ELSE p_status END
$$;

-- ============================================================== ingest
-- One entry point for every message arriving on mf/v1/site/{site}/asset/{asset}/{type}
-- Returns a JSON result Node-RED uses to decide follow-up actions.
CREATE OR REPLACE FUNCTION mf.ingest(
    p_site_code  TEXT,
    p_asset_code TEXT,
    p_msg_type   TEXT,
    p_payload    JSONB
) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
    v_asset      mf.assets%ROWTYPE;
    v_ts         TIMESTAMPTZ := COALESCE(mf.try_ts(p_payload->>'timestamp'), NOW());
    v_sig        RECORD;
    v_signal_id  UUID;
    v_count      INTEGER := 0;
    v_status     TEXT;
    v_downtime   TEXT[] := ARRAY['faulted','stopped','maintenance'];
    v_open       mf.downtime_events%ROWTYPE;
    v_event      TEXT;
    v_order      mf.production_orders%ROWTYPE;
    v_qty        INTEGER;
    v_result     TEXT;
    v_completed  JSONB := NULL;
BEGIN
    SELECT a.* INTO v_asset
      FROM mf.assets a JOIN mf.sites s ON s.id = a.site_id
     WHERE s.site_code = p_site_code AND a.asset_code = p_asset_code;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'unknown_asset',
                                  'site', p_site_code, 'asset', p_asset_code);
    END IF;

    UPDATE mf.assets SET last_seen_at = GREATEST(COALESCE(last_seen_at, v_ts), v_ts)
     WHERE id = v_asset.id;

    -- ---------------------------------------------------------- telemetry
    IF p_msg_type = 'telemetry' THEN
        IF jsonb_typeof(p_payload->'signals') IS DISTINCT FROM 'object' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'signals_object_required');
        END IF;

        FOR v_sig IN SELECT key, value FROM jsonb_each(p_payload->'signals') LOOP
            INSERT INTO mf.asset_signals (asset_id, signal_name, data_type, unit)
            VALUES (v_asset.id, v_sig.key,
                    CASE jsonb_typeof(v_sig.value) WHEN 'number' THEN 'numeric' ELSE 'text' END,
                    p_payload->'units'->>v_sig.key)
            ON CONFLICT (asset_id, signal_name) DO UPDATE
               SET unit = COALESCE(EXCLUDED.unit, mf.asset_signals.unit)
            RETURNING id INTO v_signal_id;

            INSERT INTO mf.telemetry (asset_id, signal_id, value_numeric, value_text, recorded_at)
            VALUES (v_asset.id, v_signal_id,
                    CASE WHEN jsonb_typeof(v_sig.value) = 'number' THEN (v_sig.value)::text::double precision END,
                    CASE WHEN jsonb_typeof(v_sig.value) <> 'number' THEN v_sig.value #>> '{}' END,
                    v_ts);

            UPDATE mf.asset_signals
               SET last_value_numeric = CASE WHEN jsonb_typeof(v_sig.value) = 'number' THEN (v_sig.value)::text::double precision END,
                   last_value_text    = CASE WHEN jsonb_typeof(v_sig.value) <> 'number' THEN v_sig.value #>> '{}' END,
                   last_recorded_at   = v_ts
             WHERE id = v_signal_id;
            v_count := v_count + 1;
        END LOOP;

        RETURN jsonb_build_object('ok', true, 'type', 'telemetry', 'signals', v_count);

    -- ---------------------------------------------------------- status
    ELSIF p_msg_type = 'status' THEN
        v_status := lower(p_payload->>'status');
        IF v_status IS NULL OR v_status NOT IN ('running','idle','stopped','faulted','maintenance','offline') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', p_payload->>'status');
        END IF;

        IF v_status IS DISTINCT FROM v_asset.status THEN
            UPDATE mf.assets SET status = v_status, status_changed_at = v_ts WHERE id = v_asset.id;
        END IF;

        SELECT * INTO v_open FROM mf.downtime_events
         WHERE asset_id = v_asset.id AND ended_at IS NULL;

        -- close the open downtime if the asset recovered or changed downtime state
        IF FOUND AND (v_status <> ALL (v_downtime) OR v_open.status <> v_status) THEN
            UPDATE mf.downtime_events
               SET ended_at = v_ts,
                   duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (v_ts - started_at)))::int
             WHERE id = v_open.id;
            v_open := NULL;
        END IF;

        IF v_status = ANY (v_downtime) AND v_open.id IS NULL THEN
            INSERT INTO mf.downtime_events (asset_id, status, reason_code, reason_description, started_at)
            VALUES (v_asset.id, v_status, p_payload->>'reason_code', p_payload->>'reason_description', v_ts);
        END IF;

        RETURN jsonb_build_object('ok', true, 'type', 'status', 'status', v_status,
                                  'changed', v_status IS DISTINCT FROM v_asset.status);

    -- ---------------------------------------------------------- event
    ELSIF p_msg_type = 'event' THEN
        v_event := lower(COALESCE(p_payload->>'event_type', ''));
        IF v_event = '' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'event_type_required');
        END IF;

        IF v_event = 'online' THEN
            -- device (re)started and lost its work: hand running orders back for re-dispatch
            UPDATE mf.production_orders SET status = 'released'
             WHERE asset_id = v_asset.id AND status = 'running';
        END IF;

        IF v_event = 'order_started' THEN
            UPDATE mf.production_orders
               SET status = 'running', started_at = COALESCE(started_at, v_ts)
             WHERE asset_id = v_asset.id
               AND order_number = p_payload->>'order_number'
               AND status IN ('released','running')
            RETURNING * INTO v_order;
        ELSE
            SELECT * INTO v_order FROM mf.production_orders
             WHERE asset_id = v_asset.id AND status = 'running'
             ORDER BY started_at LIMIT 1;
        END IF;

        v_qty := COALESCE((p_payload->>'quantity')::int, 1);

        INSERT INTO mf.production_events (asset_id, production_order_id, event_type, quantity, event_time, metadata)
        VALUES (v_asset.id, v_order.id, v_event, v_qty, v_ts, p_payload);

        IF v_event = 'cycle_complete' THEN
            v_result := lower(COALESCE(p_payload->>'quality_result', 'good'));
            IF v_result NOT IN ('good','scrap','rework') THEN v_result := 'good'; END IF;

            INSERT INTO mf.quality_events (asset_id, production_order_id, part_number, result, defect_code, event_time)
            VALUES (v_asset.id, v_order.id,
                    COALESCE(p_payload->>'part_number', v_order.part_number, v_asset.default_part_number),
                    v_result, p_payload->>'defect_code', v_ts);

            IF v_order.id IS NOT NULL THEN
                UPDATE mf.production_orders
                   SET completed_quantity = completed_quantity + CASE WHEN v_result = 'good' THEN v_qty ELSE 0 END,
                       scrap_quantity     = scrap_quantity     + CASE WHEN v_result = 'good' THEN 0 ELSE v_qty END
                 WHERE id = v_order.id
                RETURNING * INTO v_order;

                IF v_order.completed_quantity >= v_order.target_quantity THEN
                    UPDATE mf.production_orders
                       SET status = 'complete', completed_at = v_ts
                     WHERE id = v_order.id
                    RETURNING * INTO v_order;

                    v_completed := jsonb_build_object(
                        'order_number',   v_order.order_number,
                        'part_number',    v_order.part_number,
                        'good_quantity',  v_order.completed_quantity,
                        'scrap_quantity', v_order.scrap_quantity,
                        'completed_at',   v_order.completed_at,
                        'site',           p_site_code,
                        'asset',          p_asset_code);
                END IF;
            END IF;
        END IF;

        RETURN jsonb_build_object('ok', true, 'type', 'event', 'event_type', v_event,
                                  'order_number', v_order.order_number,
                                  'order_completed', v_completed);
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'unknown_message_type', 'type', p_msg_type);
END $$;

-- ============================================================== orders
CREATE OR REPLACE FUNCTION mf.create_order(
    p_site_code TEXT, p_asset_code TEXT, p_order_number TEXT,
    p_part_number TEXT, p_target INTEGER, p_source TEXT
) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
    v_asset mf.assets%ROWTYPE;
    v_order mf.production_orders%ROWTYPE;
BEGIN
    SELECT a.* INTO v_asset
      FROM mf.assets a JOIN mf.sites s ON s.id = a.site_id
     WHERE s.site_code = p_site_code AND a.asset_code = p_asset_code;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'status_code', 404, 'error', 'unknown_asset');
    END IF;

    BEGIN
        INSERT INTO mf.production_orders (site_id, asset_id, order_number, part_number, target_quantity, source_system)
        VALUES (v_asset.site_id, v_asset.id, p_order_number,
                COALESCE(p_part_number, v_asset.default_part_number), p_target, p_source)
        RETURNING * INTO v_order;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'status_code', 409,
            'error', 'duplicate_order_or_asset_busy',
            'detail', 'order_number already exists, or the asset already has an open order');
    END;

    RETURN jsonb_build_object('ok', true, 'status_code', 201, 'order', mf.order_json(v_order.id));
END $$;

CREATE OR REPLACE FUNCTION mf.order_json(p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'order_number',       o.order_number,
        'site',               s.site_code,
        'asset',              a.asset_code,
        'part_number',        o.part_number,
        'target_quantity',    o.target_quantity,
        'completed_quantity', o.completed_quantity,
        'scrap_quantity',     o.scrap_quantity,
        'percent_complete',   ROUND(100.0 * o.completed_quantity / o.target_quantity, 1),
        'status',             o.status,
        'source_system',      o.source_system,
        'released_at',        o.released_at,
        'started_at',         o.started_at,
        'completed_at',       o.completed_at)
      FROM mf.production_orders o
      JOIN mf.sites s ON s.id = o.site_id
      LEFT JOIN mf.assets a ON a.id = o.asset_id
     WHERE o.id = p_id
$$;

-- Released orders not yet acknowledged by the machine (re-dispatched by Node-RED)
CREATE OR REPLACE FUNCTION mf.pending_dispatch() RETURNS TABLE (
    site_code TEXT, asset_code TEXT, order_number TEXT, part_number TEXT, target_quantity INT)
LANGUAGE sql STABLE AS $$
    SELECT s.site_code, a.asset_code, o.order_number, o.part_number, o.target_quantity
      FROM mf.production_orders o
      JOIN mf.assets a ON a.id = o.asset_id
      JOIN mf.sites  s ON s.id = o.site_id
     WHERE o.status = 'released'
       AND mf.effective_status(a.status, a.last_seen_at) <> 'offline'
$$;

-- ============================================================== read API
CREATE OR REPLACE FUNCTION mf.asset_json(p_asset_id UUID) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'site',          s.site_code,
        'asset',         a.asset_code,
        'name',          a.name,
        'asset_type',    a.asset_type,
        'area',          ar.name,
        'status',        mf.effective_status(a.status, a.last_seen_at),
        'status_changed_at', a.status_changed_at,
        'last_seen_at',  a.last_seen_at,
        'signals', COALESCE((
            SELECT jsonb_object_agg(sg.signal_name, jsonb_build_object(
                       'value', COALESCE(to_jsonb(sg.last_value_numeric), to_jsonb(sg.last_value_text)),
                       'unit',  sg.unit,
                       'at',    sg.last_recorded_at))
              FROM mf.asset_signals sg WHERE sg.asset_id = a.id), '{}'::jsonb),
        'active_order', (
            SELECT mf.order_json(o.id) FROM mf.production_orders o
             WHERE o.asset_id = a.id AND o.status IN ('released','running')
             ORDER BY o.released_at LIMIT 1),
        'open_downtime', (
            SELECT jsonb_build_object('status', d.status, 'reason_code', d.reason_code,
                                      'reason_description', d.reason_description,
                                      'started_at', d.started_at)
              FROM mf.downtime_events d WHERE d.asset_id = a.id AND d.ended_at IS NULL))
      FROM mf.assets a
      JOIN mf.sites s ON s.id = a.site_id
      LEFT JOIN mf.areas ar ON ar.id = a.area_id
     WHERE a.id = p_asset_id
$$;

CREATE OR REPLACE FUNCTION mf.api_assets() RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(mf.asset_json(a.id) ORDER BY a.asset_code), '[]'::jsonb)
      FROM mf.assets a
$$;

CREATE OR REPLACE FUNCTION mf.api_asset(p_asset_code TEXT) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT mf.asset_json(a.id) FROM mf.assets a WHERE a.asset_code = p_asset_code LIMIT 1
$$;

CREATE OR REPLACE FUNCTION mf.api_production(p_limit INT DEFAULT 50) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'released_at') DESC), '[]'::jsonb)
      FROM (SELECT mf.order_json(o.id) AS j
              FROM mf.production_orders o
             ORDER BY o.released_at DESC
             LIMIT p_limit) x
$$;

CREATE OR REPLACE FUNCTION mf.api_order(p_order_number TEXT) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT mf.order_json(o.id) FROM mf.production_orders o WHERE o.order_number = p_order_number
$$;

-- One consolidated object for the plant view.
CREATE OR REPLACE FUNCTION mf.api_dashboard(p_site_code TEXT DEFAULT 'demo') RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_site  mf.sites%ROWTYPE;
    v_start TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_site FROM mf.sites WHERE site_code = p_site_code;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_start := date_trunc('day', NOW() AT TIME ZONE v_site.timezone) AT TIME ZONE v_site.timezone;

    RETURN jsonb_build_object(
        'generated_at', NOW(),
        'site', jsonb_build_object('code', v_site.site_code, 'name', v_site.name, 'day_start', v_start),

        'assets', COALESCE((SELECT jsonb_agg(mf.asset_json(a.id) ORDER BY a.asset_code)
                              FROM mf.assets a WHERE a.site_id = v_site.id), '[]'::jsonb),

        'production', COALESCE((SELECT jsonb_agg(mf.order_json(o.id) ORDER BY o.released_at DESC)
                                  FROM (SELECT * FROM mf.production_orders
                                         WHERE site_id = v_site.id
                                         ORDER BY (status IN ('released','running')) DESC, released_at DESC
                                         LIMIT 8) o), '[]'::jsonb),

        'downtime_today', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'asset', t.asset_code, 'minutes', t.minutes,
                       'events', t.events, 'top_reason', t.top_reason)
                     ORDER BY t.asset_code)
              FROM (SELECT a.asset_code,
                           ROUND((COALESCE(SUM(CASE WHEN d.id IS NOT NULL THEN EXTRACT(EPOCH FROM
                               (COALESCE(d.ended_at, NOW()) - GREATEST(d.started_at, v_start))) END), 0) / 60.0)::numeric, 1) AS minutes,
                           COUNT(d.id) AS events,
                           MODE() WITHIN GROUP (ORDER BY d.reason_code) AS top_reason
                      FROM mf.assets a
                      LEFT JOIN mf.downtime_events d
                             ON d.asset_id = a.id AND COALESCE(d.ended_at, NOW()) >= v_start
                     WHERE a.site_id = v_site.id
                     GROUP BY a.asset_code) t), '[]'::jsonb),

        'quality_today', (
            SELECT jsonb_build_object(
                       'good',  COUNT(*) FILTER (WHERE q.result = 'good'),
                       'scrap', COUNT(*) FILTER (WHERE q.result <> 'good'),
                       'first_pass_yield_pct',
                           CASE WHEN COUNT(*) = 0 THEN NULL
                                ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE q.result = 'good') / COUNT(*), 1) END)
              FROM mf.quality_events q JOIN mf.assets a ON a.id = q.asset_id
             WHERE a.site_id = v_site.id AND q.event_time >= v_start),

        'erp_receipts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'order_number', r.order_number, 'part_number', r.part_number,
                       'good_quantity', r.good_quantity, 'scrap_quantity', r.scrap_quantity,
                       'received_at', r.received_at) ORDER BY r.received_at DESC)
              FROM (SELECT * FROM demo_erp.production_receipts ORDER BY received_at DESC LIMIT 5) r), '[]'::jsonb),

        'recent_events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'asset', x.asset_code, 'event_type', x.event_type,
                       'event_time', x.event_time, 'detail', x.detail) ORDER BY x.event_time DESC)
              FROM (SELECT a.asset_code, e.event_type, e.event_time,
                           COALESCE(e.metadata->>'order_number', e.metadata->>'defect_code') AS detail
                      FROM mf.production_events e JOIN mf.assets a ON a.id = e.asset_id
                     WHERE a.site_id = v_site.id AND e.event_type <> 'cycle_complete'
                     ORDER BY e.event_time DESC LIMIT 10) x), '[]'::jsonb)
    );
END $$;

-- ============================================================== demo ERP + housekeeping
CREATE OR REPLACE FUNCTION demo_erp.record_receipt(p JSONB) RETURNS JSONB
LANGUAGE sql AS $$
    INSERT INTO demo_erp.production_receipts
        (order_number, part_number, good_quantity, scrap_quantity, completed_at, payload)
    VALUES (p->>'order_number', p->>'part_number',
            (p->>'good_quantity')::int, (p->>'scrap_quantity')::int,
            mf.try_ts(p->>'completed_at'), p)
    RETURNING jsonb_build_object('ok', true, 'receipt_id', id)
$$;

-- Idle assets with no open order -> the demo ERP releases a new order for them.
CREATE OR REPLACE FUNCTION demo_erp.assets_needing_orders() RETURNS TABLE (
    site_code TEXT, asset_code TEXT, part_number TEXT)
LANGUAGE sql STABLE AS $$
    SELECT s.site_code, a.asset_code, a.default_part_number
      FROM mf.assets a JOIN mf.sites s ON s.id = a.site_id
     WHERE mf.effective_status(a.status, a.last_seen_at) <> 'offline'
       AND NOT EXISTS (SELECT 1 FROM mf.production_orders o
                        WHERE o.asset_id = a.id AND o.status IN ('released','running'))
$$;

CREATE OR REPLACE FUNCTION mf.purge_telemetry(p_keep_days INT DEFAULT 7) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE n INTEGER;
BEGIN
    DELETE FROM mf.telemetry WHERE recorded_at < NOW() - make_interval(days => p_keep_days);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;
