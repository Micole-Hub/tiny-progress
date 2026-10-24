# TinyProgress same-code, full-stack QA

The older `local-preview.html` / `local-preview-connection.js` simulated the browser and **did not test the real backend or sync**. They are no longer the correct testing route.

## What is identical

Run `node tests/qa-mirror.js` from the project root. This serves **index.html** and the exact existing `script.js`, `style.css`, `github-page/connection.js`, milestones, domain, and other frontend assets. It also imports the **actual** `backend/server.js`, `backend/domain.js`, and normal API routes, using the same GAS program deployed separately against a **test-only spreadsheet**.

Only the test login implementation is substituted. The local API accepts a nonempty password and issues a process-local bearer token. The rest of the frontend login/sync client code remains unchanged. The test login is not the production password verification. All task, date, archive, event, and save rules remain the same. No prefilled mock tasks. The test database can start empty or contain data intentionally entered for QA.

## Prerequisites (not yet provisioned)

1. Create a **new Google Sheets spreadsheet**, distinct from your actual TinyProgress data.
2. Deploy a **separate GAS web app** from the same `gas/Code.gs` + `gas/TPDomain.gs` source, bound to the separate spreadsheet. Set a **new dedicated secret** in GAS for this test instance, consistent with its own deployment settings. Do not edit/deploy the existing production GAS web app.
3. Copy `tests/qa-mirror-env.example` to `tests/.env.qa`; fill in the dedicated test GAS `/exec` URL and test secret, and retain the explicit isolation confirmation. File is gitignored.
4. Install dependencies in `backend` with `npm ci`. Use Node 24 or later. (These steps affect the local computer only.)

Then run, at the repository root:

```bash
node tests/qa-mirror.js
```

Visit `http://127.0.0.1:5517/`. **Do not use Live Server** for this integrated test, and don't open `local-preview.html`. In the unchanged login screen enter server URL `http://127.0.0.1:3017` and any nonempty temporary QA password. Leave "remember device" unchecked (it is not part of this test).

The test-only API invokes the same GAS read/write operations as production against the isolated test spreadsheet. Browser devtools Network should show local API routes, not your Render API URL. Test data is never uploaded to the real account.

## Test plan

- On desktop and at 390px width, verify task column alignment, no overflow, week/day nested navigation, and the original growth-tree/leaf animations.
- Confirm only the task checkmark changes completion; only `••• → 編輯` opens the editor.
- Check current-date coral circle has **no floating red dot**, and green underline is selection.
- Create a dated and undated task, schedule via "本週還沒排", create and complete weekly habits.
- Refresh and confirm the task state persisted **to the separate test spreadsheet**; check revision & conflict handling using two tabs.
- Inspect History when a week has truly finished; do not advance by prematurely completing tasks.
- Confirm no requests to the production Render URL, no production Sheets changes, and no LINE webhooks or reminders.

## Safety boundaries and limitations

- This mirror **refuses startup** unless a separate GAS URL, 32+ character secret, and explicit test-sheet isolation confirmation are provided. It also refuses a URL equal to `GOOGLE_SHEETS_API_URL` if that variable is present.
- An arbitrary URL cannot be automatically proven to point to a separate spreadsheet. You must independently confirm the test GAS points to the test spreadsheet; never paste production credentials.
- LINE, queues, and reminder routes are blocked in this QA runner. That is an intentional safety difference.
- Browser screenshots and end-to-end behavior have **not yet been verified** simply by committing these files. Open the real QA site and run the above checks.
- This runner is bound to 127.0.0.1; it is for local development, not public deployment. Do not merge `tests/qa-mirror.js` or any test-secret configuration into the production deployment workflow.
