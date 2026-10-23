import json, os
H = os.path.dirname(os.path.abspath(__file__))
S = os.path.join(H, 'studio')
def rd(n): return open(os.path.join(S, n)).read().rstrip('\n')
Q = json.load(open(os.path.join(S, 'queries.json')))

nodes = []
def add(n): nodes.append(n); return n

def tab(i, label, info=''): add({"id": i, "type": "tab", "label": label, "disabled": False, "info": info})
def comment(i, z, name, info, x=200, y=40): add({"id": i, "type": "comment", "z": z, "name": name, "info": info, "x": x, "y": y, "wires": []})
def fn(i, z, name, code, x, y, wires, outputs=1):
    add({"id": i, "type": "function", "z": z, "name": name, "func": code, "outputs": outputs, "timeout": 0, "noerr": 0,
         "initialize": "", "finalize": "", "libs": [], "x": x, "y": y, "wires": wires})
def inject(i, z, name, every, x, y, wires):
    add({"id": i, "type": "inject", "z": z, "name": name, "props": [{"p": "payload"}], "repeat": str(every), "crontab": "",
         "once": True, "onceDelay": "1", "topic": "", "payload": "", "payloadType": "date", "x": x, "y": y, "wires": [wires]})
def pg(i, z, name, x, y, wires):
    add({"id": i, "type": "postgresql", "z": z, "name": name, "query": "", "postgreSQLConfig": "pg_cfg", "split": False,
         "rowsPerMsg": 1, "outputs": 1, "x": x, "y": y, "wires": [wires]})
def catch(i, z, x, y, wires):
    add({"id": i, "type": "catch", "z": z, "name": "any error on this page", "scope": None, "uncaught": False, "x": x, "y": y, "wires": [wires]})

# ---------------------------------------------------------------- config nodes
add({"id": "pg_cfg", "type": "postgreSQLConfig", "name": "Manufaction database (read-mostly)", "host": "${PGHOST}", "hostFieldType": "str",
     "port": "5432", "portFieldType": "num", "database": "${PGDATABASE}", "databaseFieldType": "str", "ssl": "false", "sslFieldType": "bool",
     "applicationName": "manufaction-studio", "applicationNameType": "str", "max": 5, "maxFieldType": "num", "idle": 1000,
     "idleFieldType": "num", "connectionTimeout": 10000, "connectionTimeoutFieldType": "num", "user": "${PGUSER}", "userFieldType": "str",
     "password": "${PGPASSWORD}", "passwordFieldType": "str"})
add({"id": "ui_base", "type": "ui-base", "name": "Manufaction", "path": "/dashboard", "appIcon": "", "includeClientData": True,
     "acceptsClientConfig": ["ui-notification", "ui-control"], "showPathInSidebar": False, "headerContent": "page",
     "navigationStyle": "default", "titleBarStyle": "default", "showReconnectNotification": True, "notificationDisplayTime": 1,
     "showDisconnectNotification": True, "allowInstall": False})
THEME_COLORS = {"surface": "#ffffff", "primary": "#0f766e", "bgPage": "#f1f5f4", "groupBg": "#ffffff", "groupOutline": "#d5dedc"}
add({"id": "ui_theme", "type": "ui-theme", "name": "Brand theme",
     "colors": THEME_COLORS,
     "sizes": {"density": "default", "pagePadding": "12px", "groupGap": "12px", "groupBorderRadius": "8px", "widgetGap": "12px"}})

BP = [{"name": "Default", "px": 0, "cols": 3}, {"name": "Tablet", "px": 576, "cols": 6}, {"name": "Small Desktop", "px": 768, "cols": 9}, {"name": "Desktop", "px": 1024, "cols": 12}]
def page(i, name, path, icon, order):
    add({"id": i, "type": "ui-page", "name": name, "ui": "ui_base", "path": path, "icon": icon, "layout": "grid", "theme": "ui_theme",
         "breakpoints": BP, "order": order, "className": "", "visible": True, "disabled": False})
def group(i, pg_, name, width, order, show=True):
    add({"id": i, "type": "ui-group", "name": name, "page": pg_, "width": width, "height": 1, "order": order, "showTitle": show,
         "className": "", "visible": True, "disabled": False, "groupType": "default"})

page("pg_over", "Plant overview", "/overview", "factory", 1)
page("pg_admin", "Settings", "/settings", "settings", 2)

# ---------------------------------------------------------------- shared look
CSS_NOTE = ""
POLL = 3

def view(z, key, widget, y, every=POLL, x0=150):
    """inject -> build query -> postgresql -> shape -> widget.  Returns the id of the query node (so others can trigger a refresh)."""
    q = Q[key]
    ids = [f"{key}_{s}" for s in ("i", "q", "p", "s", "w")]
    inject(ids[0], z, f"Every {every} s", every, x0, y, [ids[1]])
    fn(ids[1], z, f"Query: {key}", q['query'], x0 + 190, y, [[ids[2]]])
    pg(ids[2], z, "Run SQL", x0 + 380, y, [ids[3]])
    shape = q['shape'] or "msg.payload = msg.payload || [];\nreturn msg;"
    fn(ids[3], z, "Shape for the screen", shape, x0 + 550, y, [[ids[4]]])
    widget['id'] = ids[4]; widget['z'] = z; widget['x'] = x0 + 760; widget['y'] = y; widget.setdefault('wires', [[]])
    add(widget)
    return ids[1]

def tpl(group_id, name, code, order, width=12):
    return {"type": "ui-template", "group": group_id, "page": "", "ui": "", "name": name, "order": order, "width": width, "height": 0,
            "head": "", "format": code, "storeOutMessages": True, "passthru": True, "resendOnRefresh": True,
            "templateScope": "local", "className": ""}
def table(group_id, name, order, width=12):
    return {"type": "ui-table", "group": group_id, "name": name, "label": "", "order": order, "width": width, "height": 0, "maxrows": 0,
            "passthru": False, "autocols": True, "showSearch": True, "deselect": True, "selectionType": "none", "columns": [],
            "mobileBreakpoint": "sm", "mobileBreakpointType": "defaults", "action": "replace", "className": ""}

# ================================================================ TAB 1: Plant overview
tab("tab_over", "Plant overview", "Everything on the Plant overview page. Each row of nodes is one panel: a timer asks the "
    "database a question, a function shapes the answer, and a widget draws it. To change a panel, edit its SQL (the "
    "'Query' function) or its look (the template). Nothing here can change production data: this instance logs in to "
    "the database with a restricted user.")
comment("c_over", "tab_over", "Plant overview: one row = one panel", "Timer -> Query -> Run SQL -> Shape -> Widget.\nDouble-click any node to change it. Deploy (top right) makes the change live for everyone.")
for gid, nm, w, o in [("g_head", "Plant", 12, 0), ("g_kpi", "Today", 12, 1), ("g_alert", "Alerts", 12, 2), ("g_mach", "Machines", 12, 3),
                      ("g_dt", "Downtime today", 6, 4), ("g_ord", "Production orders", 6, 5),
                      ("g_wr", "Maintenance work requests", 6, 6), ("g_rcpt", "Receipts sent to the ERP", 6, 7),
                      ("g_feed", "Recent notices", 12, 8)]:
    group(gid, "pg_over", nm, w, o, show=(gid not in ("g_head", "g_kpi", "g_alert", "g_mach")))
y = 90
view("tab_over", "plant", {"type": "ui-text", "group": "g_head", "order": 1, "width": 12, "height": 1, "name": "Plant name", "label": "",
      "format": "{{msg.payload}}", "layout": "row-left", "style": True, "font": "", "fontSize": 20, "color": "#0f766e",
      "wrapText": False, "className": "", "value": "payload", "valueType": "msg"}, y, every=30); y += 70
view("tab_over", "kpis", tpl("g_kpi", "KPI tiles", rd("tpl_kpis.vue"), 1), y); y += 70
view("tab_over", "alerts", tpl("g_alert", "Alert banner", rd("tpl_alerts.vue"), 1), y); y += 70
view("tab_over", "machines", tpl("g_mach", "Machine cards", rd("tpl_machines.vue"), 1), y); y += 70
view("tab_over", "downtime", tpl("g_dt", "Downtime bars", rd("tpl_downtime.vue"), 1, 6), y); y += 70
view("tab_over", "orders", table("g_ord", "Orders", 1, 6), y); y += 70
view("tab_over", "workrequests", table("g_wr", "Work requests", 1, 6), y); y += 70
view("tab_over", "receipts", table("g_rcpt", "Receipts", 1, 6), y); y += 70
view("tab_over", "feed", table("g_feed", "Notices", 1, 12), y); y += 90

# toast flow: new alert -> pop-up on every open dashboard
add({"id": "n_toast", "type": "ui-notification", "z": "tab_over", "ui": "ui_base", "position": "top right", "colorDefault": True,
     "color": "#000000", "displayTime": "8", "showCountdown": True, "outputs": 0, "allowDismiss": True, "dismissText": "Close",
     "allowConfirm": False, "raw": False, "className": "", "name": "Pop-up alerts", "x": 960, "y": y, "wires": []})
inject("toast_i", "tab_over", "Every 2 s", 2, 150, y, ["toast_q"])
fn("toast_q", "tab_over", "New notices since last look", rd("t_toast.js"), 340, y, [["toast_p"]])
pg("toast_p", "tab_over", "Run SQL", 560, y, ["toast_o"])
fn("toast_o", "tab_over", "One pop-up per notice", rd("t_toast_out.js"), 740, y, [["n_toast"]])

# ================================================================ TAB 2: Settings & admin
tab("tab_admin", "Settings & admin", "Customer administration: change how the plant behaves without touching code. "
    "Each form writes to the database through a restricted user, then the tables refresh.")
comment("c_admin", "tab_admin", "Settings, fault catalogue and machines",
        "Form -> Check the input -> Run SQL -> Tell the user -> refresh the table.\nYou can add your own forms the same way.")
for gid, nm, w, o in [("a_set", "Settings", 12, 1), ("a_setf", "Change a setting", 6, 2), ("a_reas", "Fault catalogue", 12, 3),
                      ("a_reasf", "Add or change a fault code", 6, 4), ("a_mach", "Machines", 12, 5), ("a_machf", "Add or change a machine", 6, 6)]:
    group(gid, "pg_admin", nm, w, o)

y = 90
set_q = view("tab_admin", "settings", table("a_set", "Settings table", 1, 12), y, every=10); y += 70
reas_q = view("tab_admin", "reasons", table("a_reas", "Fault table", 1, 12), y, every=10); y += 70
mach_q = view("tab_admin", "machinelist", table("a_mach", "Machine table", 1, 12), y, every=10); y += 90

def form(i, z, group_id, name, label, options, x, y, wires):
    add({"id": i, "type": "ui-form", "z": z, "group": group_id, "name": name, "label": label, "order": 1, "width": 6, "height": 0,
         "options": options, "formValue": {o['key']: "" for o in options}, "payload": "", "submit": "Save", "cancel": "Clear",
         "resetOnSubmit": True, "topic": "topic", "topicType": "msg", "splitLayout": False, "className": "", "passthru": False,
         "dropdownOptions": [], "x": x, "y": y, "wires": [wires]})
def opt(label, key, typ="text", required=False, rows=None):
    o = {"label": label, "key": key, "type": typ, "required": required}
    if rows: o["rows"] = rows
    return o

# result handler shared by all three forms:  output 1 -> toast, output 2 -> refresh table
RESULT = """const ok = (msg.payload && msg.payload.length) ? true : false;
if (!ok) return [{ payload: msg.notFound || 'Nothing was changed.', color: '#d97706' }, null];
return [{ payload: msg.done, color: '#16a34a' }, { payload: 'refresh' }];"""
ERR = """return { payload: 'Could not save: ' + String((msg.error && msg.error.message) || 'unknown error').replace(/^error: /i, ''), color: '#dc2626' };"""

def admin_flow(prefix, y, group_id, label, options, check_code, refresh_node, two_step=False):
    form(f"{prefix}_f", "tab_admin", group_id, label, label, options, 170, y, [f"{prefix}_c"])
    first = f"{prefix}_pre" if two_step else f"{prefix}_p"
    fn(f"{prefix}_c", "tab_admin", "Check the input and build the SQL", check_code, 400, y, [[first], [f"{prefix}_n"]], outputs=2)
    if two_step:
        pg(f"{prefix}_pre", "tab_admin", "Step 1: make sure the area exists", 650, y, [f"{prefix}_mid"])
        fn(f"{prefix}_mid", "tab_admin", "Step 2: now the machine", "msg.query = msg.query2;\nmsg.params = msg.params2;\nreturn msg;", 860, y, [[f"{prefix}_p"]])
    off = 400 if two_step else 0
    pg(f"{prefix}_p", "tab_admin", "Run SQL", 650 + off, y, [f"{prefix}_r"])
    fn(f"{prefix}_r", "tab_admin", "Tell the user", RESULT, 820 + off, y, [[f"{prefix}_n"], [refresh_node]], outputs=2)
    add({"id": f"{prefix}_n", "type": "ui-notification", "z": "tab_admin", "ui": "ui_base", "position": "top right", "colorDefault": True,
         "color": "#000000", "displayTime": "5", "showCountdown": False, "outputs": 0, "allowDismiss": True, "dismissText": "Close",
         "allowConfirm": False, "raw": False, "className": "", "name": "Toast", "x": 1040 + (400 if two_step else 0), "y": y, "wires": []})

REJECT = "return [null, { payload: %s, color: '#dc2626' }];"

admin_flow("fs", y, "a_setf", "Change a setting", [
    opt("Setting name (exactly as in the table)", "key", "text", True),
    opt("New value (a number, text in quotes, or a list like [\"faulted\"])", "value", "text", True)],
"""const p = msg.payload || {};
const key = String(p.key || '').trim();
let raw = String(p.value === undefined ? '' : p.value).trim();
if (!key || raw === '') return [null, { payload: 'Both a setting name and a value are needed.', color: '#dc2626' }];
let json;
try { json = JSON.parse(raw); } catch (e) { json = raw; }   // plain words are stored as text
msg.query = `UPDATE mf.settings SET value = $2::jsonb, updated_at = now(), updated_by = 'studio' WHERE key = $1 RETURNING key`;
msg.params = [key, JSON.stringify(json)];
msg.done = `Setting "${key}" is now ${JSON.stringify(json)}. The plant picks it up within 10 seconds.`;
msg.notFound = `There is no setting called "${key}". Copy the name from the table above.`;
return [msg, null];""", set_q); y += 90

admin_flow("fr", y, "a_reasf", "Add or change a fault code", [
    opt("Code (capitals and underscores, e.g. JAM)", "code", "text", True),
    opt("What it means", "description", "text", True),
    opt("Machine type it applies to (press, cnc, assembly; blank = any)", "asset_type"),
    opt("Severity (critical, warning or info)", "severity", "text", True),
    opt("Who gets the work request (blank = default)", "assigned_to"),
    opt("Active", "active", "switch")],
"""const p = msg.payload || {};
const code = String(p.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
const sev = String(p.severity || '').trim().toLowerCase();
if (!code || !String(p.description || '').trim()) return [null, { payload: 'A code and a description are needed.', color: '#dc2626' }];
if (!['critical', 'warning', 'info'].includes(sev)) return [null, { payload: 'Severity must be critical, warning or info.', color: '#dc2626' }];
msg.query = `INSERT INTO mf.reason_codes (code, description, asset_type, severity, assigned_to, active, updated_at)
             VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), $6, now())
             ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, asset_type = EXCLUDED.asset_type,
                  severity = EXCLUDED.severity, assigned_to = EXCLUDED.assigned_to, active = EXCLUDED.active, updated_at = now()
             RETURNING code`;
msg.params = [code, String(p.description).trim(), String(p.asset_type || '').trim().toLowerCase(), sev, String(p.assigned_to || '').trim(), p.active !== false];
msg.done = `Fault code ${code} saved.`;
return [msg, null];""", reas_q); y += 90

admin_flow("fm", y, "a_machf", "Add or change a machine", [
    opt("Machine code (used in MQTT topics, e.g. PRESS-003)", "code", "text", True),
    opt("Display name", "name", "text", True),
    opt("Area (e.g. Stamping)", "area", "text", True),
    opt("Type (press, cnc, assembly)", "type", "text", True),
    opt("Default part number", "part"),
    opt("Ideal seconds per part", "cycle", "number")],
"""const p = msg.payload || {};
const code = String(p.code || '').trim().toUpperCase();
if (!/^[A-Z0-9][A-Z0-9_-]{1,40}$/.test(code)) return [null, { payload: 'The machine code can use capitals, numbers, - and _ only.', color: '#dc2626' }];
if (!String(p.name || '').trim() || !String(p.area || '').trim() || !String(p.type || '').trim())
    return [null, { payload: 'Name, area and type are needed.', color: '#dc2626' }];
const cycle = (p.cycle === '' || p.cycle === null || p.cycle === undefined) ? null : Number(p.cycle);
if (cycle !== null && !(cycle > 0 && cycle < 100000)) return [null, { payload: 'Seconds per part must be a positive number.', color: '#dc2626' }];
msg.query = `INSERT INTO mf.areas (site_id, name) SELECT id, $1 FROM mf.sites ORDER BY created_at LIMIT 1
             ON CONFLICT (site_id, name) DO NOTHING`;
msg.params = [String(p.area).trim()];
msg.query2 = `INSERT INTO mf.assets (site_id, area_id, asset_code, name, asset_type, default_part_number, ideal_cycle_seconds)
  SELECT s.id, ar.id, $1, $2, $4, NULLIF($5, ''), $6
    FROM (SELECT id FROM mf.sites ORDER BY created_at LIMIT 1) s
    JOIN mf.areas ar ON ar.site_id = s.id AND ar.name = $3
  ON CONFLICT (site_id, asset_code) DO UPDATE SET area_id = EXCLUDED.area_id, name = EXCLUDED.name, asset_type = EXCLUDED.asset_type,
       default_part_number = EXCLUDED.default_part_number, ideal_cycle_seconds = EXCLUDED.ideal_cycle_seconds
  RETURNING asset_code`;
msg.params2 = [code, String(p.name).trim(), String(p.area).trim(), String(p.type).trim().toLowerCase(), String(p.part || '').trim(), cycle];
msg.done = `Machine ${code} saved. It shows as Offline until it sends data to mf/v1/site/<site>/asset/${code}/status.`;
return [msg, null];""", mach_q, two_step=True); y += 90

# errors on the admin tab -> red toast
catch("adm_catch", "tab_admin", 170, y, ["adm_err"])
fn("adm_err", "tab_admin", "Friendly error", ERR, 400, y, [["adm_err_n"]])
add({"id": "adm_err_n", "type": "ui-notification", "z": "tab_admin", "ui": "ui_base", "position": "top right", "colorDefault": True,
     "color": "#000000", "displayTime": "8", "showCountdown": False, "outputs": 0, "allowDismiss": True, "dismissText": "Close",
     "allowConfirm": False, "raw": False, "className": "", "name": "Error toast", "x": 620, "y": y, "wires": []})

# ================================================================ TAB 3: guide
tab("tab_guide", "READ ME: your flows", "Start here.")
comment("g1", "tab_guide", "What this editor is", "This is YOUR Node-RED. It controls what the dashboard shows and the Settings page. "
        "The plant's engine (collecting machine data, counting parts, raising alerts, the REST API) runs in a separate, locked "
        "instance maintained by us, so a mistake here can never stop production data being collected.", 200, 60)
comment("g2", "tab_guide", "Change what a panel shows", "Open the 'Plant overview' tab. Double-click the 'Query' function in the row for that panel and edit the SQL. Click Deploy.", 200, 120)
comment("g3", "tab_guide", "Change how a panel looks", "Double-click the template (or table) node at the end of the row. Colours and layout live there; the brand theme is under the dashboard sidebar > Theme.", 200, 180)
comment("g4", "tab_guide", "Add a new panel", "Copy a row (select, Ctrl+C, Ctrl+V), change the SQL, change the widget's group. Tables are the easiest: any SQL that returns rows becomes a table.", 200, 240)
comment("g5", "tab_guide", "Safe by design", "This instance connects to the database as a restricted user: it can read everything, but only write settings, fault codes and the machine list. Production counts, orders and alerts are written by the locked engine only.", 200, 300)

out = os.path.join(os.environ.get('OUT', '.'), 'flows.json')
json.dump(nodes, open(out, 'w'), indent=2)
print(len(nodes), 'nodes ->', out)
