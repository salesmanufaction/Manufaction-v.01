# Manufaction CORE: the Node-RED that runs the backend (ingestion, rules, alerts, REST API).
# Owner-only. The customer never gets a login to this one.
FROM nodered/node-red:5.0.7

# node-red-contrib-postgresql: the PostgreSQL config node (kept for owners who prefer visual SQL nodes)
# pg: the driver the core flows use directly (global "db" helper, see data/settings.js)
RUN npm install --no-audit --no-fund --omit=dev \
        node-red-contrib-postgresql@0.16.2 pg@8
ENV NODE_PATH=/usr/src/node-red/node_modules
