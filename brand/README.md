# Brand assets

Everything a customer sees in the editors and logins comes from this folder, mounted read-only at `/brand` in both Node-RED containers.

| File | Used for |
|---|---|
| `mark.png` / `mark.svg` | login page image (256 px), also the dashboard header mark |
| `header.png` | editor header logo (60 px) |
| `favicon.png` / `favicon.svg` | browser tab icon (simplified bold M for small sizes) |
| `mark-on-dark.svg`, `logo-horizontal.svg` | decks, documents, email signatures |
| `editor.css` | colours for the editor header, Deploy button and login button |

## Rebranding for a customer

1. Replace `mark.png` (256x256), `header.png` (about 60x60 or a wide logo up to 200x40) and `favicon.png` with the customer's files, same names.
2. Edit the colours in `editor.css` (four hex values).
3. Set `MF_BRAND_NAME=Customer Name` in `.env`.
4. For the dashboard header and theme colours, open `/studio`, tab "Plant overview", the "Brand header" template, and the theme node "Brand theme" (colors).
5. `docker compose up -d core studio`.

Brand colours: graphite `#1F2937`, safety yellow `#FACC15`, steel `#475569`. Fonts: Barlow Condensed (wordmark, headings), Barlow (body); the dashboard falls back to system fonts when offline.
