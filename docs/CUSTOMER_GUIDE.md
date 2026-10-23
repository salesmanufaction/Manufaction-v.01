# Studio guide for the customer administrator

You have a Node-RED editor at **https://your-site/studio** (login supplied by us). It controls what the dashboard shows and the Settings page. The plant's data collection runs separately, so you cannot stop it by accident.

## Everyday changes (no coding)
The dashboard has three pages in the left menu: **Plant overview** (headline numbers and machine cards), **Analytics** (charts and detail tables) and **Settings**.
- **Change a setting.** Copy the name from the table (for example `yield_target_pct`), type the new value, Save. The plant picks it up within about 10 seconds.
- **Add or change a fault code.** Fill in the code, what it means, machine type, severity (critical/warning/info) and who gets the work request. Saving an existing code updates it.
- **Add a machine.** Code (used in the machine's MQTT topic), name, area, type. A new machine shows Offline until it sends data.

## Changing the dashboard (the editor)
1. Open `/studio`. The tabs **Plant overview** and **Analytics** have one row of nodes per panel: *timer → Query (SQL) → Run SQL → Shape → widget*.
2. Double-click a **Query** node to change which numbers a panel shows (any `SELECT` works; read-only is all you can do there).
3. Double-click the widget (template or table) to change layout, wording or colours. Tables display whatever rows the SQL returns.
4. Click **Deploy**. The change is live for everyone within seconds.
5. To undo, press Ctrl+Z before deploying, or ask us to restore the delivered version.

## Add a new panel
Copy a row (select its nodes, Ctrl+C, Ctrl+V), change the SQL, set the widget's group. A table is the quickest: any SQL that returns rows becomes a table.

## Colours and branding
Dashboard sidebar (top right arrow) → **Theme**. The brand colours are the theme named *Brand theme*.

## What you cannot change here
Machine data collection, order counting, alert and work-request rules, and the REST API live in a separate, locked part of the system maintained by us. Ask us and we will change it, or expose a setting for you.

## Good habits
- Export your flows (menu → Export → all flows) before large changes.
- Test SQL with a small `LIMIT` first; a very heavy query on a 3-second timer slows the dashboard.
- Do not paste passwords into nodes.
