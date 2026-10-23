// Structural check of a Node-RED flows.json: unique ids, every wire / link / group / page reference resolves,
// function nodes compile. Optional: DASH=/path/to/node-red-dashboard checks ui-* property names against the widget source.
//   node tools/lint_flows.js core/data/flows.json studio/data/flows.json
const fs = require('fs'), path = require('path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let bad = 0;
const err = (f, m) => { bad++; console.log(`  ERROR ${f}: ${m}`); };

function widgetKeys(dash, type) {
    const file = path.join(dash, 'nodes', type === 'ui-base' || type === 'ui-page' || type === 'ui-group' || type === 'ui-theme' ? 'config' : 'widgets', type.replace('ui-', 'ui_') + '.html');
    if (!fs.existsSync(file)) return null;
    const s = fs.readFileSync(file, 'utf8');
    const j = s.indexOf('defaults:', s.indexOf('registerType('));
    const k = s.indexOf('{', j); let d = 0, p = k;
    for (; p < s.length; p++) { if (s[p] === '{') d++; else if (s[p] === '}' && --d === 0) break; }
    const keys = []; d = 0;
    for (const m of s.slice(k, p + 1).matchAll(/[{}]|\n\s*(\w+):/g)) { if (m[0] === '{') d++; else if (m[0] === '}') d--; else if (d === 1) keys.push(m[1]); }
    return keys;
}
for (const f of process.argv.slice(2)) {
    const nodes = JSON.parse(fs.readFileSync(f, 'utf8'));
    const ids = new Map();
    nodes.forEach((n) => { if (ids.has(n.id)) err(f, 'duplicate id ' + n.id); ids.set(n.id, n); });
    const base = ['id', 'type', 'z', 'name', 'x', 'y', 'wires', 'g', 'd', 'info', 'l'];
    const cache = {};
    for (const n of nodes) {
        const lab = `${n.type} "${n.name || n.id}"`;
        if (n.z && !ids.has(n.z)) err(f, `${lab}: tab ${n.z} missing`);
        (n.wires || []).forEach((w) => w.forEach((t) => { if (!ids.has(t)) err(f, `${lab}: wires to missing ${t}`); else if (ids.get(t).z !== n.z) err(f, `${lab}: wire crosses tabs to ${t} (use link nodes)`); }));
        if (n.type === 'link out') (n.links || []).forEach((t) => { if (!ids.has(t)) err(f, `${lab}: link to missing ${t}`); });
        if (n.type === 'function') { try { new AsyncFunction('msg', 'node', 'context', 'flow', 'global', 'env', 'RED', n.func); } catch (e) { err(f, `${lab}: ${e.message}`); } }
        if (n.type === 'ui-notification' && !ids.has(n.ui)) err(f, `${lab}: ui-base ${n.ui} missing`);
        if (n.type === 'ui-group' && !ids.has(n.page)) err(f, `${lab}: page missing`);
        if (n.type === 'ui-page' && (!ids.has(n.ui) || !ids.has(n.theme))) err(f, `${lab}: ui-base or theme missing`);
        if (['ui-template', 'ui-table', 'ui-form', 'ui-text'].includes(n.type) && !ids.has(n.group)) err(f, `${lab}: group ${n.group} missing`);
        if (n.type === 'postgresql' && !ids.has(n.postgreSQLConfig)) err(f, `${lab}: database config missing`);
        if (process.env.DASH && n.type.startsWith('ui-')) {
            const keys = cache[n.type] || (cache[n.type] = widgetKeys(process.env.DASH, n.type));
            if (!keys) err(f, `${lab}: unknown dashboard node type`);
            else Object.keys(n).filter((k) => !base.includes(k) && !keys.includes(k)).forEach((k) => err(f, `${lab}: property "${k}" is not a ${n.type} property`));
        }
    }
    console.log(`${f}: ${nodes.length} nodes checked`);
}
console.log(bad ? `${bad} problem(s)` : 'clean');
process.exit(bad ? 1 : 0);
