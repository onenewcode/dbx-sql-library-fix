# Issue #13459 browser verification

Source commit: `b8e197cbb7d03e25dd8d4aa3778dbf3d54c2878d` (base `febdfe080`).

These are screenshots of the real dbx Vue frontend, not mockups. The browser
uses an isolated MySQL HTTP metadata fixture: six databases and 105 tables in
the selected database. No production database or user credentials are used.

1. Search for the connection name without opening any database: no table requests.
2. Expand `erp_base`: only that database is marked opened; the others remain closed.
3. Expand, collapse and re-expand the cached Tables group: no extra table request.
4. Replace the non-empty search query with `zz_late_orders`: the last table in the
   full index is found without clearing the search field first.

All assertions passed with no frontend runtime errors. `verification.json`
contains the metadata-request audit and final tree state. `capture.mjs` is the
Playwright reproduction script (install `playwright@1.58.2` beside it). Start the
source frontend with `pnpm exec vite --config apps/desktop/vite.config.ts --host
127.0.0.1 --port 5179 --strictPort`, then run `node capture.mjs`. The script uses
macOS Google Chrome; adjust `executablePath` on other platforms.

This branch only stores PR evidence and is not part of the source-change PR.
