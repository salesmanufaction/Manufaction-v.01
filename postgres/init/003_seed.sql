-- Demo factory master data (synthetic). Matches simulator/simulator.py.
SET search_path = mf, public;

WITH org AS (
    INSERT INTO organizations (name) VALUES ('Manufaction Demo Co.') RETURNING id
), site AS (
    INSERT INTO sites (organization_id, site_code, name, location)
    SELECT id, 'demo', 'Manufaction Demo Factory', 'Virtual' FROM org RETURNING id
), ar AS (
    INSERT INTO areas (site_id, name)
    SELECT site.id, x.name FROM site, (VALUES ('Stamping'), ('Machining'), ('Assembly')) AS x(name)
    RETURNING id, name, site_id
)
INSERT INTO assets (site_id, area_id, asset_code, name, asset_type, manufacturer, model,
                    default_part_number, ideal_cycle_seconds)
SELECT ar.site_id, ar.id, v.code, v.name, v.type, v.mfr, v.model, v.part, v.cycle
  FROM ar JOIN (VALUES
      ('Stamping',  'PRESS-001',    'Press 001',    'press',    'Demo Industries', 'P-200',  'BRKT-100', 8.0),
      ('Machining', 'CNC-001',      'CNC 001',      'cnc',      'Demo Industries', 'VMC-40', 'SHAFT-220', 20.0),
      ('Assembly',  'ASSEMBLY-001', 'Assembly 001', 'assembly', 'Demo Industries', 'AC-1',   'ASSY-500', 15.0),
      ('Stamping',  'PRESS-002',    'Press 002',    'press',    'Demo Industries', 'P-200',  'BRKT-150', 10.0),
      ('Machining', 'CNC-002',      'CNC 002',      'cnc',      'Demo Industries', 'VMC-40', 'SHAFT-340', 25.0),
      ('Assembly',  'ASSEMBLY-002', 'Assembly 002', 'assembly', 'Demo Industries', 'AC-1',   'ASSY-720', 18.0)
  ) AS v(area, code, name, type, mfr, model, part, cycle) ON v.area = ar.name;
