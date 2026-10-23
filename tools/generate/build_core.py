import json, os
H = os.path.dirname(os.path.abspath(__file__))
def js(name): return open(os.path.join(H, name)).read().rstrip('\n')
API = json.load(open(os.path.join(H, 'api_routes.json')))

nodes = []
def add(n): nodes.append(n); return n

def tab(i, label, info=''):
    add({"id": i, "type": "tab", "label": label, "disabled": False, "info": info})

def comment(i, z, name, info, x=170, y=40, w=None):
    add({"id": i, "type": "comment", "z": z, "name": name, "info": info, "x": x, "y": y, "wires": []})

def fn(i, z, name, code, x, y, wires, outputs=1, initialize=''):
    add({"id": i, "type": "function", "z": z, "name": name, "func": code, "outputs": outputs,
         "timeout": 0, "noerr": 0, "initialize": initialize, "finalize": "", "libs": [],
         "x": x, "y": y, "wires": wires if wires is not None else [[] for _ in range(outputs)]})

def inject(i, z, name, every, delay, x, y, wires):
    add({"id": i, "type": "inject", "z": z, "name": name, "props": [{"p": "payload"}],
         "repeat": str(every), "crontab": "", "once": True, "onceDelay": str(delay),
         "topic": "", "payload": "", "payloadType": "date", "x": x, "y": y, "wires": [wires]})

def debug(i, z, name, x, y, complete="payload"):
    add({"id": i, "type": "debug", "z": z, "name": name, "active": True, "tosidebar": True,
         "console": False, "tostatus": False, "complete": complete, "targetType": "msg" if complete == "payload" else "full",
         "statusVal": "", "statusType": "auto", "x": x, "y": y, "wires": []})

def mqtt_out(i, z, name, x, y):
    add({"id": i, "type": "mqtt out", "z": z, "name": name, "topic": "", "qos": "1", "retain": "false",
         "respTopic": "", "contentType": "", "userProps": "", "correl": "", "expiry": "",
         "broker": "mqtt_cfg", "x": x, "y": y, "wires": []})

def http_request(i, z, name, ret, x, y, wires):
    add({"id": i, "type": "http request", "z": z, "name": name, "method": "use", "ret": ret,
         "paytoqs": "ignore", "url": "", "tls": "", "persist": False, "proxy": "",
         "insecureHTTPParser": False, "authType": "", "senderr": False, "headers": [],
         "x": x, "y": y, "wires": [wires]})

def catch(i, z, x, y, wires):
    add({"id": i, "type": "catch", "z": z, "name": "errors on this tab", "scope": None, "uncaught": False,
         "x": x, "y": y, "wires": [wires]})

def link_out(i, z, name, target, x, y):
    add({"id": i, "type": "link out", "z": z, "name": name, "mode": "link", "links": [target], "x": x, "y": y, "wires": []})
def link_in(i, z, name, source, x, y, wires):
    add({"id": i, "type": "link in", "z": z, "name": name, "links": [source], "x": x, "y": y, "wires": [wires]})

# -------------------------------------------------------------- config node
add({"id": "mqtt_cfg", "type": "mqtt-broker", "name": "Manufaction MQTT", "broker": "${MQTT_HOST}", "port": "1883",
     "clientid": "mf-core", "autoConnect": True, "usetls": False, "protocolVersion": "4", "keepalive": "30",
     "cleansession": True, "autoUnsubscribe": True, "birthTopic": "", "birthQos": "0", "birthPayload": "",
     "birthMsg": {}, "closeTopic": "", "closeQos": "0", "closePayload": "", "closeMsg": {}, "willTopic": "",
     "willQos": "0", "willPayload": "", "willMsg": {}, "userProps": "", "sessionExpiry": ""})

# ================================================================== 00 Library & settings
tab("tab_lib", "00 Library & settings")
comment("c_lib", "tab_lib", "Shared helpers and live settings",
        "The Library node (no input) runs once at start and stores helper functions in global context "
        "(global.get('lib')): asset lookup, order rules, status rules. The 'Load settings' node reads "
        "mf.settings and mf.reason_codes every 10 s into global.get('cfg'). The customer edits those two tables "
        "in Studio, so their changes apply within 10 s and need no flow change.")
fn("lib_fn", "tab_lib", "Library (runs once at start)", "return null;", 230, 120, [[]], initialize=js('lib.js'))
inject("cfg_tick", "tab_lib", "every 10 s", 10, 1, 140, 200, ["cfg_load"])
fn("cfg_load", "tab_lib", "Load settings", js('cfg_load.js'), 340, 200, [[]])
catch("lib_catch", "tab_lib", 140, 280, ["lib_err"])
debug("lib_err", "tab_lib", "settings errors", 340, 280, "error")

# ================================================================== 01 Ingestion
tab("tab_ingest", "01 Ingestion")
comment("c_ing", "tab_ingest", "mf/v1/site/{site}/asset/{asset}/{telemetry|status|event}",
        "Machines (or the REST API) publish to MQTT. This tab checks each message and applies the rules: "
        "telemetry is stored, status updates the machine and opens or closes downtime, events count parts "
        "against the active order and complete it. Downtime changes continue on tab 04.")
add({"id": "ing_in", "type": "mqtt in", "z": "tab_ingest", "name": "all asset messages", "topic": "mf/v1/site/+/asset/+/+",
     "qos": "1", "datatype": "utf8", "broker": "mqtt_cfg", "nl": False, "rap": True, "rh": 0, "inputs": 0,
     "x": 150, "y": 120, "wires": [["ing_route"]]})
fn("ing_route", "tab_ingest", "Check topic and JSON", js('ing_route.js'), 380, 120,
   [["ing_tel"], ["ing_stat"], ["ing_evt"]], outputs=3)
fn("ing_tel", "tab_ingest", "Store telemetry", js('ing_telemetry.js'), 620, 80, [[], ["ing_rej"]], outputs=2)
fn("ing_stat", "tab_ingest", "Apply status", js('ing_status.js'), 620, 160, [["lo_open"], ["lo_close"], ["ing_rej"]], outputs=3)
fn("ing_evt", "tab_ingest", "Apply event (count parts)", js('ing_event.js'), 620, 260, [["ing_cmd_out"], ["ing_erp_req"], ["ing_rej"]], outputs=3)
link_out("lo_open", "tab_ingest", "downtime opened", "li_open", 860, 140)
link_out("lo_close", "tab_ingest", "downtime closed", "li_close", 860, 180)
mqtt_out("ing_cmd_out", "tab_ingest", "command -> machine", 900, 240)
http_request("ing_erp_req", "tab_ingest", "POST receipt to ERP", "obj", 900, 290, ["ing_erp_dbg"])
debug("ing_erp_dbg", "tab_ingest", "ERP response", 1110, 290)
debug("ing_rej", "tab_ingest", "rejected messages", 900, 340)
catch("ing_catch", "tab_ingest", 150, 400, ["ing_err_dbg"])
debug("ing_err_dbg", "tab_ingest", "ingestion errors", 380, 400, "error")

# ================================================================== 02 REST API
tab("tab_api", "02 REST API")
comment("c_api", "tab_api", "REST API v1",
        "Every route except /health needs Authorization: Bearer $MF_API_TOKEN. Caddy adds the token for browser "
        "users who passed the login. Each route is one function node: check the token, read or write the "
        "database, answer. POSTs of telemetry/events/status are published to MQTT so they take the same path as a device.")
routes = [
  ("health", "GET", "/api/v1/health", "Health", "health"),
  ("assets", "GET", "/api/v1/assets", "List assets", "assets"),
  ("asset", "GET", "/api/v1/assets/:asset_code", "Get asset", "asset"),
  ("orders", "GET", "/api/v1/production", "List orders", "orders"),
  ("order", "GET", "/api/v1/production/:order_number", "Get order", "order"),
  ("downtime", "GET", "/api/v1/downtime", "List downtime", "downtime"),
  ("create_order", "POST", "/api/v1/production-orders", "Create order", "create_order"),
  ("telemetry", "POST", "/api/v1/telemetry", "Ingest telemetry", "ingest_telemetry"),
  ("events", "POST", "/api/v1/events", "Ingest events", "ingest_events"),
  ("status", "POST", "/api/v1/status", "Ingest status", "ingest_status"),
]
y = 100
for rid, method, url, name, key in routes:
    add({"id": f"api_in_{rid}", "type": "http in", "z": "tab_api", "name": f"{method} {url}", "url": url,
         "method": method.lower(), "upload": False, "swaggerDoc": "", "x": 190, "y": y, "wires": [[f"api_fn_{rid}"]]})
    fn(f"api_fn_{rid}", "tab_api", name, API[key], 470, y, [["api_resp"], ["api_mqtt"]], outputs=2)
    y += 50
add({"id": "api_resp", "type": "http response", "z": "tab_api", "name": "respond", "statusCode": "", "headers": {},
     "x": 760, "y": 200, "wires": []})
mqtt_out("api_mqtt", "tab_api", "publish to MQTT", 770, 330)
catch("api_catch", "tab_api", 190, 640, ["api_err"])
fn("api_err", "tab_api", "500 if a request is waiting", r"""if (!msg.res) { node.warn(msg.error && msg.error.message); return null; }
msg.statusCode = 500;
msg.headers = { 'content-type': 'application/json' };
msg.payload = { error: 'internal_error' };
node.warn(msg.error && msg.error.message);
return msg;""", 470, 640, [["api_resp"]])

# ================================================================== 03 Orders & dispatch
tab("tab_orders", "03 Orders & dispatch")
comment("c_ord", "tab_orders", "Dispatch released orders (retries until the machine confirms)",
        "A released order is sent to its machine with start_order. If the machine is offline or misses it, this "
        "tab sends it again every 'dispatch_retry_seconds' (a setting) until the machine answers order_started.")
inject("disp_tick", "tab_orders", "every 5 s", 5, 8, 150, 120, ["disp_fn"])
fn("disp_fn", "tab_orders", "Re-send start_order", js('disp.js'), 380, 120, [["disp_out"]])
mqtt_out("disp_out", "tab_orders", "command -> machine", 640, 120)
catch("disp_catch", "tab_orders", 150, 220, ["disp_err"])
debug("disp_err", "tab_orders", "dispatch errors", 380, 220, "error")

# ================================================================== 04 Alerts & maintenance
tab("tab_alerts", "04 Alerts & maintenance")
comment("c_alr", "tab_alerts", "Downtime -> alert + maintenance work request",
        "When a machine goes down: record a dashboard alert and, for faults, a maintenance work request (WR-YYMMDD-NNN) "
        "assigned from the reason-code catalogue. When it recovers: close the request and post a recovery notice. "
        "Which statuses count, and who is assigned, are settings and reason codes the customer edits in Studio.")
link_in("li_open", "tab_alerts", "downtime opened", "lo_open", 150, 120, ["alr_open"])
fn("alr_open", "tab_alerts", "Raise alert + work request", js('alr_open.js'), 380, 120, [[]])
link_in("li_close", "tab_alerts", "downtime closed", "lo_close", 150, 200, ["alr_close"])
fn("alr_close", "tab_alerts", "Close request + recovery notice", js('alr_close.js'), 380, 200, [[]])
catch("alr_catch", "tab_alerts", 150, 300, ["alr_err"])
debug("alr_err", "tab_alerts", "alert errors", 380, 300, "error")

# ================================================================== 05 Notifications
tab("tab_notify", "05 Notifications")
comment("c_ntf", "tab_notify", "Alerts -> webhook (set MF_NOTIFY_WEBHOOK_URL in .env)",
        "Sends each new alert to Slack, Mattermost, Discord, ntfy.sh, Zapier, Make or any HTTPS endpoint. "
        "MF_NOTIFY_FORMAT picks the shape (json, slack, discord, text). Off until a URL is set.")
inject("ntf_tick", "tab_notify", "every 5 s", 5, 20, 150, 120, ["ntf_q"])
fn("ntf_q", "tab_notify", "Find undelivered alerts", js('ntf_q.js'), 370, 120, [["ntf_build"]])
fn("ntf_build", "tab_notify", "Format message", js('ntf_build.js'), 600, 120, [["ntf_req"]])
http_request("ntf_req", "tab_notify", "POST to webhook", "txt", 810, 120, ["ntf_ok"])
fn("ntf_ok", "tab_notify", "Record result", js('ntf_ok.js'), 1010, 120, [[]])
catch("ntf_catch", "tab_notify", 150, 240, ["ntf_err"])
fn("ntf_err", "tab_notify", "Record failure", js('ntf_err.js'), 370, 240, [[]])

# ================================================================== 06 Demo ERP
tab("tab_erp", "06 Demo ERP")
comment("c_erp", "tab_erp", "ERP -> Manufaction: release an order to every idle machine",
        "Stands in for a customer ERP. It releases work orders through the public REST API and receives the "
        "production receipt when an order completes. Replace it with a real connector (SAP, Plex, Odoo ...) "
        "or switch it off with DEMO_ERP_ENABLED=false.")
inject("erp_tick", "tab_erp", "every 20 s", 20, 15, 150, 120, ["erp_orders"])
fn("erp_orders", "tab_erp", "Build orders", js('erp_orders.js'), 360, 120, [["erp_req"]])
http_request("erp_req", "tab_erp", "POST /api/v1/production-orders", "obj", 600, 120, ["erp_dbg"])
debug("erp_dbg", "tab_erp", "order released", 840, 120)
comment("c_erp2", "tab_erp", "Manufaction -> ERP: production receipts", "The receipt sent when an order completes.", y=220)
add({"id": "erp_in", "type": "http in", "z": "tab_erp", "name": "POST /demo-erp/receipts", "url": "/demo-erp/receipts",
     "method": "post", "upload": False, "swaggerDoc": "", "x": 190, "y": 280, "wires": [["erp_rec"]]})
fn("erp_rec", "tab_erp", "Record receipt", js('erp_receipt.js'), 430, 280, [["erp_resp"]])
add({"id": "erp_resp", "type": "http response", "z": "tab_erp", "name": "respond", "statusCode": "", "headers": {},
     "x": 640, "y": 280, "wires": []})
catch("erp_catch", "tab_erp", 190, 360, ["erp_err"])
fn("erp_err", "tab_erp", "500", r"""if (!msg.res) { node.warn(msg.error && msg.error.message); return null; }
msg.statusCode = 500; msg.payload = { error: 'internal_error' };
return msg;""", 430, 360, [["erp_resp"]])

# ================================================================== 07 Housekeeping
tab("tab_house", "07 Housekeeping")
comment("c_house", "tab_house", "Nightly clean-up", "Deletes raw telemetry older than the 'telemetry_keep_days' setting.")
inject("purge_tick", "tab_house", "daily", 86400, 60, 150, 120, ["purge_fn"])
fn("purge_fn", "tab_house", "Purge old telemetry", js('purge.js'), 380, 120, [[]])

# ------------------------------------------------------------------ write
ids = [n['id'] for n in nodes]
assert len(ids) == len(set(ids)), [i for i in ids if ids.count(i) > 1]
out = os.environ.get('OUT', os.path.join(H, 'core_flows.json'))
json.dump(nodes, open(out, 'w'), indent=4)
print('wrote', out, len(nodes), 'nodes')
