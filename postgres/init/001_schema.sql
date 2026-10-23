-- Manufaction v0.1 — canonical manufacturing data model
-- Runs automatically on first start of an EMPTY postgres volume.
-- Loosely aligned to ISA-95 levels: enterprise > site > area > asset.

CREATE SCHEMA IF NOT EXISTS mf;
CREATE SCHEMA IF NOT EXISTS demo_erp;

SET search_path = mf, public;

-- ---------------------------------------------------------------- hierarchy
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    site_code       VARCHAR(50)  NOT NULL UNIQUE,      -- used in MQTT topics
    name            VARCHAR(200) NOT NULL,
    location        VARCHAR(200),
    timezone        VARCHAR(64)  NOT NULL DEFAULT 'America/New_York',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE areas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     UUID NOT NULL REFERENCES sites(id),
    name        VARCHAR(200) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, name)
);

CREATE TABLE assets (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id            UUID NOT NULL REFERENCES sites(id),
    area_id            UUID REFERENCES areas(id),
    asset_code         VARCHAR(100) NOT NULL,          -- used in MQTT topics
    name               VARCHAR(200) NOT NULL,
    asset_type         VARCHAR(100),
    manufacturer       VARCHAR(200),
    model              VARCHAR(200),
    default_part_number VARCHAR(100),
    ideal_cycle_seconds NUMERIC(10,2),
    status             VARCHAR(20) NOT NULL DEFAULT 'offline',
    status_changed_at  TIMESTAMPTZ,
    last_seen_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, asset_code),
    CONSTRAINT assets_status_chk CHECK (status IN
        ('running','idle','stopped','faulted','maintenance','offline'))
);

CREATE TABLE asset_signals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id     UUID NOT NULL REFERENCES assets(id),
    signal_name  VARCHAR(200) NOT NULL,
    data_type    VARCHAR(50),
    unit         VARCHAR(50),
    description  TEXT,
    last_value_numeric DOUBLE PRECISION,
    last_value_text    TEXT,
    last_recorded_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (asset_id, signal_name)
);

-- ---------------------------------------------------------------- production
CREATE TABLE production_orders (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id            UUID NOT NULL REFERENCES sites(id),
    asset_id           UUID REFERENCES assets(id),
    order_number       VARCHAR(100) NOT NULL UNIQUE,
    part_number        VARCHAR(100) NOT NULL,
    target_quantity    INTEGER NOT NULL CHECK (target_quantity > 0),
    completed_quantity INTEGER NOT NULL DEFAULT 0,      -- good parts
    scrap_quantity     INTEGER NOT NULL DEFAULT 0,
    status             VARCHAR(20) NOT NULL DEFAULT 'released',
    source_system      VARCHAR(100),                    -- e.g. DEMO-ERP, SAP, Plex
    released_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    seeded             BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE for pre-loaded demo history
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT po_status_chk CHECK (status IN ('released','running','complete','cancelled'))
);
-- one open order per asset
CREATE UNIQUE INDEX po_one_open_per_asset
    ON production_orders (asset_id) WHERE status IN ('released','running');

CREATE TABLE production_events (
    id                  BIGSERIAL PRIMARY KEY,
    asset_id            UUID REFERENCES assets(id),
    production_order_id UUID REFERENCES production_orders(id),
    event_type          VARCHAR(100) NOT NULL,
    quantity            INTEGER DEFAULT 1,
    event_time          TIMESTAMPTZ NOT NULL,
    metadata            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX production_events_asset_time ON production_events (asset_id, event_time DESC);

CREATE TABLE downtime_events (
    id                 BIGSERIAL PRIMARY KEY,
    asset_id           UUID NOT NULL REFERENCES assets(id),
    status             VARCHAR(20) NOT NULL,
    reason_code        VARCHAR(100),
    reason_description VARCHAR(255),
    started_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ,
    duration_seconds   INTEGER,
    seeded             BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE for pre-loaded demo history
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX downtime_one_open_per_asset ON downtime_events (asset_id) WHERE ended_at IS NULL;
CREATE INDEX downtime_asset_time ON downtime_events (asset_id, started_at DESC);

CREATE TABLE quality_events (
    id                  BIGSERIAL PRIMARY KEY,
    asset_id            UUID REFERENCES assets(id),
    production_order_id UUID REFERENCES production_orders(id),
    part_number         VARCHAR(100),
    result              VARCHAR(20) NOT NULL CHECK (result IN ('good','scrap','rework')),
    defect_code         VARCHAR(100),
    metadata            JSONB,
    event_time          TIMESTAMPTZ NOT NULL,
    seeded              BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE for pre-loaded demo history
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX quality_events_asset_time ON quality_events (asset_id, event_time DESC);

-- ---------------------------------------------------------------- alerts & maintenance
-- Created by triggers on downtime_events (see 002_functions.sql). v0.1 records the work
-- request and shows it on the dashboard; real delivery (email/SMS/CMMS) is a v0.2 connector.
CREATE SEQUENCE work_request_seq;

CREATE TABLE maintenance_requests (
    id                BIGSERIAL PRIMARY KEY,
    request_number    VARCHAR(30) NOT NULL UNIQUE,          -- WR-YYMMDD-001
    asset_id          UUID NOT NULL REFERENCES assets(id),
    downtime_event_id BIGINT REFERENCES downtime_events(id) ON DELETE CASCADE,
    reason_code       VARCHAR(100),
    description       VARCHAR(255),
    assigned_to       VARCHAR(100) NOT NULL DEFAULT 'Maintenance on-call',
    status            VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at         TIMESTAMPTZ,
    seeded            BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX maintenance_requests_open ON maintenance_requests (opened_at DESC);

CREATE TABLE notifications (
    id                BIGSERIAL PRIMARY KEY,
    kind              VARCHAR(40) NOT NULL
                      CHECK (kind IN ('downtime_alert','maintenance_dispatched','recovered')),
    severity          VARCHAR(20) NOT NULL CHECK (severity IN ('critical','info','success')),
    asset_id          UUID REFERENCES assets(id),
    downtime_event_id BIGINT REFERENCES downtime_events(id) ON DELETE CASCADE,
    title             VARCHAR(200) NOT NULL,
    message           VARCHAR(500),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seeded            BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX notifications_time ON notifications (created_at DESC, id DESC);

-- ---------------------------------------------------------------- telemetry
-- Plain table for v0.1. When volume grows, move to TimescaleDB or partitioning.
CREATE TABLE telemetry (
    id            BIGSERIAL PRIMARY KEY,
    asset_id      UUID NOT NULL REFERENCES assets(id),
    signal_id     UUID REFERENCES asset_signals(id),
    value_numeric DOUBLE PRECISION,
    value_text    TEXT,
    recorded_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX telemetry_asset_time  ON telemetry (asset_id, recorded_at DESC);
CREATE INDEX telemetry_signal_time ON telemetry (signal_id, recorded_at DESC);

-- ---------------------------------------------------------------- demo ERP
-- Stands in for a customer ERP that receives production receipts back.
CREATE TABLE demo_erp.production_receipts (
    id                 BIGSERIAL PRIMARY KEY,
    order_number       VARCHAR(100) NOT NULL,
    part_number        VARCHAR(100),
    good_quantity      INTEGER,
    scrap_quantity     INTEGER,
    completed_at       TIMESTAMPTZ,
    received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload            JSONB
);
