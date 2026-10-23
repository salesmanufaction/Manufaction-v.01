const rows = msg.payload || [];
if (msg.init) { flow.set('last', rows[0] ? rows[0].last : 0); return null; }
if (!rows.length) return null;
flow.set('last', rows[rows.length - 1].id);
const COLOUR = { critical: '#dc2626', warning: '#d97706', success: '#16a34a', info: '#2563eb' };
return [rows.map((n) => ({
    payload: `${n.title}${n.message ? ': ' + n.message : ''}`,
    color: COLOUR[n.severity] || '#2563eb',
}))];
