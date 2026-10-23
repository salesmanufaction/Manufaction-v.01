-- Adds Press 002, CNC 002 and Assembly 002 to an EXISTING database (the init scripts only run on an
-- empty volume). Safe to re-run: machines that already exist are skipped.
--   ./scripts/demo_add_machines.sh      then restart the simulator (the script does it)
SET search_path = mf, public;

INSERT INTO assets (site_id, area_id, asset_code, name, asset_type, manufacturer, model,
                    default_part_number, ideal_cycle_seconds)
SELECT ar.site_id, ar.id, v.code, v.name, v.type, v.mfr, v.model, v.part, v.cycle
  FROM areas ar
  JOIN sites s ON s.id = ar.site_id AND s.site_code = 'demo'
  JOIN (VALUES
      ('Stamping',  'PRESS-002',    'Press 002',    'press',    'Demo Industries', 'P-200',  'BRKT-150', 10.0),
      ('Machining', 'CNC-002',      'CNC 002',      'cnc',      'Demo Industries', 'VMC-40', 'SHAFT-340', 25.0),
      ('Assembly',  'ASSEMBLY-002', 'Assembly 002', 'assembly', 'Demo Industries', 'AC-1',   'ASSY-720', 18.0)
  ) AS v(area, code, name, type, mfr, model, part, cycle) ON v.area = ar.name
ON CONFLICT (site_id, asset_code) DO NOTHING;

SELECT asset_code, name, status FROM assets ORDER BY asset_code;
