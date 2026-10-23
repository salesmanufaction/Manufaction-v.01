/**
 * Manufaction Node-RED settings (v0.1)
 * Full reference: https://nodered.org/docs/user-guide/runtime/configuration
 * Secrets come from environment variables (see .env.example) — never hard-code them here.
 */
const crypto = require('crypto');

// Constant-time bearer-token check shared by every API route (global.get('mfAuthorize')).
function mfAuthorize(req) {
    const expected = process.env.MF_API_TOKEN || '';
    const header = (req && req.headers && req.headers.authorization) || '';
    if (expected.length < 24 || !header.startsWith('Bearer ')) return false;
    const a = Buffer.from(header.slice(7));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const adminHash = process.env.NODE_RED_ADMIN_HASH;

module.exports = {
    flowFile: 'flows.json',
    flowFilePretty: true,

    // flows_cred.json holds only ${ENV_VAR} placeholders (committed to Git), so it is left unencrypted.
    // Rule for this repo: never type a real secret into a node's credential field in the editor —
    // add an env var to .env / docker-compose.yml and reference it as ${MY_VAR} instead.
    credentialSecret: false,

    uiPort: process.env.PORT || 1880,

    // Editor login. The editor is also only published on 127.0.0.1 (see docker-compose.yml);
    // reach it over an SSH tunnel:  ssh -L 1880:127.0.0.1:1880 user@your-vm
    adminAuth: adminHash ? {
        type: 'credentials',
        users: [{ username: process.env.NODE_RED_ADMIN_USER || 'admin', password: adminHash, permissions: '*' }],
    } : undefined,

    functionGlobalContext: { mfAuthorize },
    functionExternalModules: false,
    exportGlobalContextKeys: false,

    // Keep the runtime quiet and private.
    diagnostics: { enabled: false, ui: false },
    runtimeState: { enabled: false, ui: false },
    telemetry: { enabled: false, updateNotification: false },

    logging: {
        console: { level: process.env.NODE_RED_LOG_LEVEL || 'info', metrics: false, audit: false },
    },

    // Turn on Projects when you want Git-backed flows inside the editor.
    editorTheme: {
        projects: { enabled: false },
        page: { title: 'Manufaction · Node-RED' },
        header: { title: 'Manufaction' },
        tours: false,
    },
};
