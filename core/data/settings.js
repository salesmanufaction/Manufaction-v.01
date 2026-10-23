/**
 * Manufaction CORE Node-RED settings (v2).
 * Secrets come from environment variables (see .env.example), never from this file.
 *
 * This instance is OWNER-ONLY. It holds everything that must keep working whatever the customer
 * builds: MQTT ingestion, order counting, downtime and alert rules, the REST API.
 */
const crypto = require('crypto');
const pg = require('pg');

// ---- PostgreSQL helper, available in every function node as  global.get('db')  ---------------
// int8 (counts, bigserial ids) and numeric come back as JavaScript numbers, not strings.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));

const pool = new pg.Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 10,
    application_name: 'manufaction-core',
});
pool.on('error', (e) => console.error('[db] idle client error:', e.message));

const db = {
    /** db.query(sql, [params]) -> { rows, rowCount } */
    query: (text, params) => pool.query(text, params),
    /** db.tx(async (c) => { await c.query(...); ... }) : one atomic transaction */
    tx: async (fn) => {
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            const out = await fn(c);
            await c.query('COMMIT');
            return out;
        } catch (e) {
            try { await c.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
            throw e;
        } finally {
            c.release();
        }
    },
};

// ---- Constant-time bearer-token check shared by every API route -------------------------------
function mfAuthorize(req) {
    const expected = process.env.MF_API_TOKEN || '';
    const header = (req && req.headers && req.headers.authorization) || '';
    if (expected.length < 24 || !header.startsWith('Bearer ')) return false;
    const a = Buffer.from(header.slice(7));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const adminHash = process.env.CORE_ADMIN_HASH;
const brand = process.env.MF_BRAND_NAME || 'Manufaction';
const brandDir = process.env.MF_BRAND_DIR || '/brand';   // logo + editor.css, mounted from ./brand

module.exports = {
    flowFile: 'flows.json',
    flowFilePretty: true,

    // flows_cred.json holds only ${ENV_VAR} placeholders (committed to Git), so it is left unencrypted.
    // Rule: never type a real secret into a node's credential field; add an env var instead.
    credentialSecret: false,

    uiPort: process.env.PORT || 1880,

    // Owner login. The editor is also published only on 127.0.0.1 (see docker-compose.yml).
    adminAuth: adminHash ? {
        type: 'credentials',
        users: [{ username: process.env.CORE_ADMIN_USER || 'owner', password: adminHash, permissions: '*' }],
    } : undefined,

    functionGlobalContext: { db, mfAuthorize },
    functionExternalModules: false,
    exportGlobalContextKeys: false,

    diagnostics: { enabled: false, ui: false },
    runtimeState: { enabled: false, ui: false },
    telemetry: { enabled: false, updateNotification: false },

    logging: {
        console: { level: process.env.NODE_RED_LOG_LEVEL || 'info', metrics: false, audit: false },
    },

    editorTheme: {
        projects: { enabled: false },
        page: {
            title: `${brand} CORE`,
            favicon: `${brandDir}/favicon.png`,
            css: `${brandDir}/editor.css`,
        },
        header: { title: `${brand} CORE (owner)`, image: `${brandDir}/header.png` },
        login: { image: `${brandDir}/mark.png` },
        tours: false,
    },
};
