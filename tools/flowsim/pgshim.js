// Test-only stand-in for the "pg" driver, built on the psql command line client.
// Why: lets the flow tests run real SQL against a real PostgreSQL without needing npm packages.
// It implements the two calls the flows use:  db.query(sql, params)  and  db.tx(async (c) => ...).
// Parameters are inlined as SQL literals; rows come back as JSON objects (like pg, but timestamps
// stay ISO strings and bigint/numeric are returned as numbers).
const { spawn } = require('child_process');

function lit(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (v instanceof Date) return `'${v.toISOString()}'`;
    if (Array.isArray(v)) return `'{${v.map((x) => '"' + String(x).replace(/(["\\])/g, '\\$1') + '"').join(',')}}'`;
    if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
}
function inline(sql, params) {
    return sql.replace(/\$(\d+)/g, (m, n) => {
        const i = Number(n) - 1;
        if (!params || i >= params.length) throw new Error(`missing parameter $${n}`);
        return lit(params[i]);
    });
}
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

class Session {
    constructor(conn) {
        this.p = spawn('sh', ['-c', `exec psql -X -q -t -A -v VERBOSITY=verbose ${conn} 2>&1`]);
        this.buf = '';
        this.waiter = null;
        this.p.stdout.on('data', (d) => { this.buf += d.toString(); this.pump(); });
        this.chain = Promise.resolve();
    }
    pump() {
        const i = this.buf.indexOf('@@END@@\n');
        if (i >= 0 && this.waiter) {
            const out = this.buf.slice(0, i);
            this.buf = this.buf.slice(i + 8);
            const w = this.waiter; this.waiter = null; w(out);
        }
    }
    raw(sql) {
        const run = () => new Promise((resolve) => {
            this.waiter = resolve;
            this.p.stdin.write(sql + '\n\\echo @@END@@\n');
            this.pump();
        });
        const r = this.chain.then(run);
        this.chain = r.catch(() => {});
        return r;
    }
    async query(sql, params) {
        const text = inline(sql, params).replace(/;\s*$/, '');
        const head = text.trim().toLowerCase();
        let out;
        if (/^(begin|commit|rollback)/.test(head)) {
            out = await this.raw(text + ';');
        } else if (/^(select|with)/.test(head) || /\breturning\b/.test(head)) {
            out = await this.raw(`WITH x AS (${text}) SELECT row_to_json(x) FROM x;`);
        } else {
            out = await this.raw(text + ';');
        }
        const lines = out.split('\n').filter((l) => l.length);
        const err = lines.find((l) => /^ERROR:/.test(l));
        if (err) {
            const m = err.match(/^ERROR:\s+([0-9A-Z]{5}):\s*(.*)$/);
            const e = new Error(m ? m[2] : err);
            e.code = m ? m[1] : undefined;
            throw e;
        }
        const rows = lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l, (k, v) => v));
        return { rows, rowCount: rows.length };
    }
    close() { try { this.p.stdin.end(); } catch (_) { /* gone */ } }
}

function makeDb(conn) {
    return {
        query: async (sql, params) => { const s = new Session(conn); try { return await s.query(sql, params); } finally { s.close(); } },
        tx: async (fn) => {
            const s = new Session(conn);
            try {
                await s.query('BEGIN');
                const out = await fn({ query: (a, b) => s.query(a, b) });
                await s.query('COMMIT');
                return out;
            } catch (e) {
                try { await s.query('ROLLBACK'); } catch (_) { /* ignore */ }
                throw e;
            } finally { s.close(); }
        },
        _session: () => new Session(conn),
    };
}
module.exports = { makeDb, TS };
