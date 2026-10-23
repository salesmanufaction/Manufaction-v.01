/**
 * Manufaction STUDIO Node-RED settings (v2).
 * The customer's Node-RED: the editor lives at /studio, the dashboard at /dashboard.
 * Two logins can open the editor: the customer admin, and the owner (so we can help).
 */
const brand = process.env.MF_BRAND_NAME || 'Manufaction';
const brandDir = process.env.MF_BRAND_DIR || '/brand';   // logo + editor.css, mounted from ./brand

const users = [];
if (process.env.STUDIO_ADMIN_HASH) {
    users.push({ username: process.env.STUDIO_ADMIN_USER || 'customer', password: process.env.STUDIO_ADMIN_HASH, permissions: '*' });
}
if (process.env.CORE_ADMIN_HASH) {
    users.push({ username: process.env.CORE_ADMIN_USER || 'owner', password: process.env.CORE_ADMIN_HASH, permissions: '*' });
}

module.exports = {
    flowFile: 'flows.json',
    flowFilePretty: true,
    credentialSecret: false,        // flows_cred.json only contains ${ENV_VAR} placeholders
    uiPort: process.env.PORT || 1880,

    httpAdminRoot: '/studio',       // the editor
    httpNodeRoot: '/',              // dashboard pages are served from here (/dashboard/...)

    adminAuth: users.length ? { type: 'credentials', users } : undefined,

    // No database helper here on purpose: Studio flows use the visible PostgreSQL nodes.
    functionExternalModules: false,
    exportGlobalContextKeys: false,
    diagnostics: { enabled: false, ui: false },
    runtimeState: { enabled: false, ui: false },
    telemetry: { enabled: false, updateNotification: false },
    logging: { console: { level: process.env.NODE_RED_LOG_LEVEL || 'info', metrics: false, audit: false } },

    editorTheme: {
        projects: { enabled: false },
        page: {
            title: `${brand} Studio`,
            favicon: `${brandDir}/favicon.png`,
            css: `${brandDir}/editor.css`,
        },
        header: { title: `${brand} Studio`, image: `${brandDir}/header.png` },
        login: { image: `${brandDir}/mark.png` },
        tours: false,
    },
};
