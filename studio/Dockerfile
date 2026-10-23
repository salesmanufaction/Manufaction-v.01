# Manufaction STUDIO: the customer's Node-RED. Dashboard + settings pages, editable by the customer admin.
# It logs in to the database as the restricted user mf_studio, so it can never alter production data.
FROM nodered/node-red:5.0.7

# Pin @flowfuse/node-red-dashboard to the exact version from your first good build (see README "Pinning").
RUN npm install --no-audit --no-fund --omit=dev \
        node-red-contrib-postgresql@0.16.2 \
        @flowfuse/node-red-dashboard@^1.30.0
