-- Manufaction demo: pre-load believable history for TODAY so the dashboard isn't empty
-- when you start recording. Synthetic data only. Safe to re-run: it removes its own earlier
-- rows first (everything flagged seeded) and never touches live data.
--
--   ./scripts/demo_seed.sh
--
-- History fills the window  [max(start of today, now - 8h),  now - 10 min].
-- Run it more than ~30 minutes after local midnight or there is nothing to show.
SET search_path = mf, public;

BEGIN;

DELETE FROM demo_erp.production_receipts WHERE order_number IN
       (SELECT order_number FROM production_orders WHERE seeded);
DELETE FROM production_events WHERE production_order_id IN
       (SELECT id FROM production_orders WHERE seeded);
DELETE FROM quality_events WHERE seeded;
DELETE FROM production_orders WHERE seeded;
DELETE FROM downtime_events WHERE seeded;       -- cascades to seeded work requests + notifications

DO $$
DECLARE
    v_site   mf.sites%ROWTYPE;
    v_start  TIMESTAMPTZ;
    v_from   TIMESTAMPTZ;
    v_to     TIMESTAMPTZ;
    v_seg    INTERVAL;
    a        RECORD;
    i        INT;
    v_o_from TIMESTAMPTZ;
    v_o_to   TIMESTAMPTZ;
    v_tgt    INT;
    v_scrap  INT;
    v_good   INT;
    v_ord    UUID;
    v_onum   TEXT;
    v_dt_at  TIMESTAMPTZ;
    v_dt_len INT;
    v_dt_id  BIGINT;
    v_code   TEXT;
    v_desc   TEXT;
    v_req    TEXT;
    v_codes  TEXT[];
    v_descs  TEXT[];
    v_pick   INT;
    v_defects TEXT[];
    v_n      INT := 0;
BEGIN
    PERFORM setseed(0.42);                      -- same-looking history every run

    SELECT * INTO v_site FROM mf.sites WHERE site_code = 'demo';
    IF NOT FOUND THEN RAISE EXCEPTION 'demo site not found; run the init scripts first'; END IF;

    v_start := date_trunc('day', NOW() AT TIME ZONE v_site.timezone) AT TIME ZONE v_site.timezone;
    v_from  := GREATEST(v_start, NOW() - INTERVAL '8 hours');
    v_to    := NOW() - INTERVAL '10 minutes';
    IF v_to - v_from < INTERVAL '30 minutes' THEN
        RAISE NOTICE 'Less than 30 minutes of "today" to fill (site time is just after midnight); nothing seeded.';
        RETURN;
    END IF;
    v_seg := (v_to - v_from) / 3;

    FOR a IN SELECT * FROM mf.assets WHERE site_id = v_site.id ORDER BY asset_code LOOP
        IF a.asset_type = 'press' THEN
            v_codes  := ARRAY['JAM','OVERTEMP','MATERIAL_SHORT'];
            v_descs  := ARRAY['Material jam in die','Hydraulic oil over temperature','Coil material shortage'];
            v_defects := ARRAY['BURR','SPLIT','DIMENSION'];
        ELSIF a.asset_type = 'cnc' THEN
            v_codes  := ARRAY['TOOL_BREAK','SPINDLE_LOAD','DOOR_OPEN'];
            v_descs  := ARRAY['Tool breakage detected','Spindle overload','Safety door opened'];
            v_defects := ARRAY['SURFACE_FINISH','DIMENSION','CHATTER'];
        ELSE
            v_codes  := ARRAY['PART_MISSING','TORQUE_FAIL','OPERATOR_ABSENT'];
            v_descs  := ARRAY['Component feeder empty','Torque out of tolerance','Operator not at station'];
            v_defects := ARRAY['MISSING_FASTENER','TORQUE','LABEL'];
        END IF;

        FOR i IN 0..2 LOOP
            v_o_from := v_from + v_seg * i + INTERVAL '3 minutes';
            v_o_to   := v_from + v_seg * (i + 1) - INTERVAL '3 minutes';
            v_tgt := CASE a.asset_type WHEN 'press' THEN 30 + floor(random() * 31)::int
                                       WHEN 'cnc'   THEN 8  + floor(random() * 9)::int
                                       ELSE              12 + floor(random() * 13)::int END;
            v_scrap := GREATEST(0, round(v_tgt * (0.01 + random() * 0.04))::int);   -- 1-5 % scrap
            v_good  := v_tgt;
            v_n     := v_n + 1;
            v_onum  := 'MO-' || to_char(v_start AT TIME ZONE v_site.timezone, 'YYMMDD') || '-' || (8000 + v_n);

            INSERT INTO mf.production_orders
                (site_id, asset_id, order_number, part_number, target_quantity, completed_quantity,
                 scrap_quantity, status, source_system, released_at, started_at, completed_at, seeded)
            VALUES (a.site_id, a.id, v_onum, a.default_part_number, v_tgt, v_good, v_scrap,
                    'complete', 'DEMO-ERP', v_o_from - INTERVAL '1 minute', v_o_from, v_o_to, TRUE)
            RETURNING id INTO v_ord;

            INSERT INTO mf.production_events (asset_id, production_order_id, event_type, quantity, event_time, metadata)
            VALUES (a.id, v_ord, 'order_started', 1, v_o_from,
                    jsonb_build_object('order_number', v_onum, 'seeded', true)),
                   (a.id, v_ord, 'order_closed', 1, v_o_to,
                    jsonb_build_object('order_number', v_onum, 'seeded', true));

            -- good parts and scrap spread across the order's run time
            INSERT INTO mf.quality_events (asset_id, production_order_id, part_number, result,
                                           defect_code, event_time, seeded)
            SELECT a.id, v_ord, a.default_part_number,
                   CASE WHEN g.n <= v_scrap THEN 'scrap' ELSE 'good' END,
                   CASE WHEN g.n <= v_scrap THEN v_defects[1 + (g.n % 3)] END,
                   v_o_from + (v_o_to - v_o_from) * (g.n::float / (v_good + v_scrap + 1)),
                   TRUE
              FROM generate_series(1, v_good + v_scrap) AS g(n);

            INSERT INTO demo_erp.production_receipts
                (order_number, part_number, good_quantity, scrap_quantity, completed_at, received_at, payload)
            VALUES (v_onum, a.default_part_number, v_good, v_scrap, v_o_to, v_o_to + INTERVAL '2 seconds',
                    jsonb_build_object('order_number', v_onum, 'seeded', true));

            -- one fault in the middle of two of the three orders
            IF i <> 1 OR a.asset_type = 'cnc' THEN
                v_pick   := 1 + floor(random() * 3)::int;
                v_code   := v_codes[v_pick];
                v_desc   := v_descs[v_pick];
                v_dt_at  := v_o_from + (v_o_to - v_o_from) * (0.35 + random() * 0.3);
                v_dt_len := 150 + floor(random() * 420)::int;               -- 2.5 to 9.5 minutes

                INSERT INTO mf.downtime_events
                    (asset_id, status, reason_code, reason_description, started_at, ended_at,
                     duration_seconds, seeded)
                VALUES (a.id, 'faulted', v_code, v_desc, v_dt_at,
                        v_dt_at + make_interval(secs => v_dt_len), v_dt_len, TRUE)
                RETURNING id INTO v_dt_id;

                v_req := 'TMP-' || v_dt_id;          -- renumbered in time order after the loop
                INSERT INTO mf.maintenance_requests
                    (request_number, asset_id, downtime_event_id, reason_code, description,
                     status, opened_at, closed_at, seeded)
                VALUES (v_req, a.id, v_dt_id, v_code, v_desc, 'closed', v_dt_at,
                        v_dt_at + make_interval(secs => v_dt_len), TRUE);

                INSERT INTO mf.notifications (kind, severity, asset_id, downtime_event_id, title, message,
                                              created_at, seeded)
                VALUES ('downtime_alert', 'critical', a.id, v_dt_id, a.asset_code || ' faulted', v_desc,
                        v_dt_at, TRUE),
                       ('maintenance_dispatched', 'info', a.id, v_dt_id, 'Maintenance notified',
                        v_req || ' sent to Maintenance on-call for ' || a.asset_code,
                        v_dt_at + INTERVAL '1 second', TRUE),
                       ('recovered', 'success', a.id, v_dt_id, a.asset_code || ' back in production',
                        'Down for ' || mf.fmt_duration(v_dt_len),
                        v_dt_at + make_interval(secs => v_dt_len), TRUE);
            END IF;
        END LOOP;
    END LOOP;

    -- number the seeded work requests in the order they happened, continuing after any live ones
    CREATE TEMP TABLE wr_map ON COMMIT DROP AS
    SELECT r.id, r.downtime_event_id, r.request_number AS old_no,
           'WR-' || to_char(r.opened_at AT TIME ZONE v_site.timezone, 'YYMMDD') || '-'
           || lpad((COALESCE((SELECT max(substring(l.request_number FROM '[0-9]+$')::int)
                                FROM mf.maintenance_requests l WHERE NOT l.seeded), 0)
                    + row_number() OVER (ORDER BY r.opened_at, r.id))::text, 3, '0') AS new_no
      FROM mf.maintenance_requests r WHERE r.seeded;
    UPDATE mf.maintenance_requests r SET request_number = m.new_no FROM wr_map m WHERE r.id = m.id;
    UPDATE mf.notifications n SET message = replace(n.message, m.old_no, m.new_no)
      FROM wr_map m WHERE n.downtime_event_id = m.downtime_event_id AND n.seeded;
    PERFORM setval('mf.work_request_seq',
                   COALESCE((SELECT max(substring(request_number FROM '[0-9]+$')::int)
                               FROM mf.maintenance_requests), 0) + 1, false);
END $$;

COMMIT;

SELECT 'seeded: ' || (SELECT count(*) FROM mf.production_orders WHERE seeded) || ' orders, '
       || (SELECT count(*) FROM mf.downtime_events WHERE seeded) || ' downtime events, '
       || (SELECT count(*) FROM mf.quality_events WHERE seeded) || ' quality records' AS result;
