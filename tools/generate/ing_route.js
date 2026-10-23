// Every MQTT message from a machine lands here.
// topic: mf/v1/site/{site}/asset/{asset}/{telemetry|status|event}
const p = msg.topic.split('/');
if (p.length !== 7 || p[0] !== 'mf' || p[1] !== 'v1' || p[2] !== 'site' || p[4] !== 'asset') {
    node.warn(`ignored topic ${msg.topic}`);
    return null;
}
const [site, asset, type] = [p[3], p[5], p[6]];
if (type === 'command') return null;                  // our own outbound commands
if (!['telemetry', 'status', 'event'].includes(type)) {
    node.warn(`unknown message type '${type}' on ${msg.topic}`);
    return null;
}
let body;
try { body = JSON.parse(msg.payload); }
catch (e) { node.warn(`invalid JSON on ${msg.topic}`); return null; }
if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    node.warn(`payload must be a JSON object on ${msg.topic}`); return null;
}
msg.mf = { site, asset, type };
msg.body = body;
node.status({ text: `${asset} ${type} @ ${new Date().toLocaleTimeString()}` });
return [type === 'telemetry' ? msg : null, type === 'status' ? msg : null, type === 'event' ? msg : null];
