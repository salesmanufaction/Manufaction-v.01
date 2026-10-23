// A small Node-RED look-alike for tests. It loads a flows.json and runs the node types the Manufaction
// flows use (function, inject, mqtt in/out, http in/out/request, link in/out, catch, debug and the
// ui-* widgets) in-process, so flow logic can be checked without Docker or a real Node-RED.
// It is NOT a full Node-RED: it checks our logic and wiring, not Node-RED's own behaviour.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class Engine {
    constructor(flows, { db, env = {}, globals = {}, log = () => {} }) {
        this.flows = flows;
        this.nodes = new Map(flows.map((n) => [n.id, n]));
        this.db = db;
        this.envVars = env;
        this.globalCtx = new Map(Object.entries(globals));
        this.flowCtx = new Map();
        this.nodeCtx = new Map();
        this.log = log;
        this.published = [];     // mqtt out
        this.http = [];          // outbound http requests that left the system
        this.httpFail = null;    // set to an Error message to make outbound requests fail
        this.httpStatus = 200;
        this.ui = new Map();     // ui-* node id -> messages received
        this.warnings = [];
        this.statuses = new Map();
        this.compiled = new Map();
        this.pending = new Set();
    }

    ctxStore(map, key) { if (!map.has(key)) map.set(key, new Map()); return map.get(key); }
    mkCtx(m) { return { get: (k) => m.get(k), set: (k, v) => { m.set(k, v); } }; }

    envApi() { return { get: (k) => this.envVars[k] }; }

    compile(n) {
        if (this.compiled.has(n.id)) return this.compiled.get(n.id);
        const f = new AsyncFunction('msg', 'node', 'context', 'flow', 'global', 'env', 'RED', n.func || 'return msg;');
        this.compiled.set(n.id, f);
        return f;
    }

    nodeApi(n) {
        return {
            id: n.id, name: n.name,
            warn: (w) => { this.warnings.push({ node: n.name || n.id, warn: typeof w === 'string' ? w : JSON.stringify(w) }); },
            error: (e) => { this.warnings.push({ node: n.name || n.id, error: String(e) }); },
            log: () => {},
            status: (s) => { this.statuses.set(n.id, s); },
            send: (m) => this.sendOut(n, m),
        };
    }

    async init() {
        for (const n of this.flows) {
            if (n.type === 'function' && n.initialize) {
                const f = new AsyncFunction('node', 'context', 'flow', 'global', 'env', 'RED', n.initialize);
                await f(this.nodeApi(n), this.mkCtx(this.ctxStore(this.nodeCtx, n.id)),
                        this.mkCtx(this.ctxStore(this.flowCtx, n.z)), this.mkCtx(this.globalCtx), this.envApi(), {});
            }
        }
    }

    global(k) { return this.globalCtx.get(k); }

    // deliver messages from one node's outputs
    sendOut(n, result, singleOutputs) {
        const wires = n.wires || [];
        const outs = Array.isArray(result) ? result : [result];
        outs.forEach((o, port) => {
            if (o === null || o === undefined) return;
            const list = Array.isArray(o) ? o : [o];
            list.forEach((m) => {
                if (m === null || m === undefined) return;
                (wires[port] || []).forEach((to) => this.deliver(to, m));
            });
        });
    }

    deliver(id, msg) {
        const p = this.run(id, msg).catch((e) => { this.warnings.push({ node: id, fatal: String(e && e.stack || e) }); });
        this.pending.add(p);
        p.finally(() => this.pending.delete(p));
    }

    async settle() {
        for (let i = 0; i < 200; i++) {
            if (!this.pending.size) { await new Promise((r) => setTimeout(r, 15)); if (!this.pending.size) return; }
            await Promise.all([...this.pending]);
        }
    }

    handleError(n, msg, err) {
        const message = err && err.message ? err.message : String(err);
        this.warnings.push({ node: n.name || n.id, error: message });
        const catchers = this.flows.filter((c) => c.type === 'catch' && c.z === n.z);
        catchers.forEach((c) => {
            const m = Object.assign({}, msg, { error: { message, source: { id: n.id, type: n.type, name: n.name } } });
            (c.wires[0] || []).forEach((to) => this.deliver(to, m));
        });
    }

    async run(id, msg) {
        const n = this.nodes.get(id);
        if (!n) throw new Error('no such node ' + id);
        if (n.d || (n.z && this.nodes.get(n.z) && this.nodes.get(n.z).disabled)) return;
        try {
            switch (n.type) {
                case 'function': {
                    const f = this.compile(n);
                    const res = await f(msg, this.nodeApi(n), this.mkCtx(this.ctxStore(this.nodeCtx, n.id)),
                                        this.mkCtx(this.ctxStore(this.flowCtx, n.z)), this.mkCtx(this.globalCtx),
                                        this.envApi(), {});
                    if (res === null || res === undefined) return;
                    // Node-RED: an array is one entry per output; an entry that is an array sends several messages
                    if (Array.isArray(res)) this.sendOut(n, res);
                    else this.sendOut(n, [res]);
                    return;
                }
                case 'postgresql': {
                    const q = n.query || msg.query;
                    const r = await this.db.query(q, msg.params || []);
                    msg.payload = r.rows; msg.pgsql = { rowCount: r.rowCount };
                    this.sendOut(n, [msg]);
                    return;
                }
                case 'mqtt in': case 'inject': this.sendOut(n, [msg]); return;
                case 'mqtt out': {
                    const payload = typeof msg.payload === 'object' ? JSON.stringify(msg.payload) : String(msg.payload);
                    this.published.push({ topic: msg.topic, payload, json: safeJson(payload) });
                    return;
                }
                case 'link out': (n.links || []).forEach((to) => this.deliver(to, msg)); return;
                case 'link in': this.sendOut(n, [msg]); return;
                case 'http in': this.sendOut(n, [msg]); return;
                case 'http response': {
                    if (msg._respond) msg._respond({ status: msg.statusCode || 200, headers: msg.headers || {}, body: msg.payload });
                    return;
                }
                case 'http request': {
                    const url = msg.url || n.url;
                    const loop = /^https?:\/\/127\.0\.0\.1:1880(\/.*)$/.exec(url);
                    if (loop) {
                        const r = await this.request(msg.method || 'GET', loop[1], { headers: msg.headers, body: msg.payload });
                        const out = Object.assign({}, msg, { statusCode: r.status, payload: r.body });
                        delete out._respond; delete out.req;
                        this.sendOut(n, [out]);
                        return;
                    }
                    if (this.httpFail) throw new Error(this.httpFail);
                    this.http.push({ method: msg.method, url, headers: msg.headers, payload: msg.payload });
                    this.sendOut(n, [Object.assign({}, msg, { statusCode: this.httpStatus, payload: 'ok' })]);
                    return;
                }
                case 'debug': case 'comment': case 'catch': return;
                default:
                    if (n.type.startsWith('ui-')) {
                        if (!this.ui.has(n.id)) this.ui.set(n.id, []);
                        this.ui.get(n.id).push(msg);
                        this.sendOut(n, [msg]);
                        return;
                    }
                    throw new Error('simulator does not support node type ' + n.type);
            }
        } catch (e) {
            this.handleError(n, msg, e);
        }
    }

    // ---- test entry points
    fire(id, payload) { this.deliver(id, { payload: payload === undefined ? Date.now() : payload, topic: '' }); return this.settle(); }
    mqtt(topic, body) { const n = this.flows.find((x) => x.type === 'mqtt in'); this.deliver(n.id, { topic, payload: typeof body === 'string' ? body : JSON.stringify(body) }); return this.settle(); }

    async request(method, path, { headers = {}, body, query = {} } = {}) {
        const [p, qs] = path.split('?');
        const q = Object.assign({}, Object.fromEntries(new URLSearchParams(qs || '')), query);
        for (const n of this.flows.filter((x) => x.type === 'http in' && x.method.toLowerCase() === method.toLowerCase())) {
            const names = []; const re = new RegExp('^' + n.url.replace(/:([A-Za-z_]+)/g, (_, k) => { names.push(k); return '([^/]+)'; }) + '$');
            const m = re.exec(p);
            if (!m) continue;
            const params = {}; names.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
            const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
            return new Promise((resolve) => {
                const msg = { payload: body === undefined ? {} : body, req: { headers: lower, params, query: q, body }, res: {}, _respond: resolve, topic: '' };
                this.deliver(n.id, msg);
                setTimeout(() => resolve({ status: 0, body: { error: 'no response from flow (timeout)' } }), 8000);
            });
        }
        return { status: 404, body: { error: 'no route' } };
    }
}
function safeJson(s) { try { return JSON.parse(s); } catch (_) { return null; } }
module.exports = { Engine };
