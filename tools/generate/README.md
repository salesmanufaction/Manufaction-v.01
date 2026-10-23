# Flow generators (owner only, optional)

`core/data/flows.json` and `studio/data/flows.json` are the source of truth once deployed. Customers and owners edit them in the Node-RED editors.
These scripts are how the first versions were produced, kept so that the **starting template** can be rebuilt for a new customer
(for example with different default panels). Function-node code lives in readable `.js` files, Vue templates in `studio/*.vue`, SQL in `studio/queries.json`.

    OUT=core/data/flows.json     python3 tools/generate/build_core.py
    OUT=studio/data              python3 tools/generate/build_studio.py     # writes flows.json into that folder

Never regenerate over a customer's live flows; export and merge instead.
