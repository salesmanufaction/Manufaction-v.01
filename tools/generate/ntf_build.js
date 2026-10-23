// Shape one alert for the destination chosen by MF_NOTIFY_FORMAT:
//   json (default, full event for Zapier / Make / your own endpoint) | slack | discord | text (ntfy.sh)
const url = env.get('MF_NOTIFY_WEBHOOK_URL');
const fmt = (env.get('MF_NOTIFY_FORMAT') || 'json').toLowerCase();
const token = env.get('MF_NOTIFY_BEARER_TOKEN');
const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
const r = msg.payload;

const m = { notification_id: r.id, method: 'POST', url, headers: {} };
if (token) m.headers.authorization = 'Bearer ' + token;
if (fmt === 'slack') {                    // Slack / Mattermost incoming webhook
    m.headers['content-type'] = 'application/json';
    m.payload = { text: r.text };
} else if (fmt === 'discord') {
    m.headers['content-type'] = 'application/json';
    m.payload = { content: r.text };
} else if (fmt === 'text') {              // ntfy.sh and similar: plain-text body
    m.headers['content-type'] = 'text/plain; charset=utf-8';
    m.headers.title = oneLine(r.title);
    m.payload = r.text;
} else {
    m.headers['content-type'] = 'application/json';
    m.payload = {
        source: 'manufaction', event: r.kind, severity: r.severity, site: r.site_code,
        asset: r.asset_code, title: r.title, message: r.text,
        work_request: r.work_request, reason_code: r.reason_code, occurred_at: r.created_at,
    };
}
return m;
