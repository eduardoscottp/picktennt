# Local browser smoke

Run from the application directory:

```powershell
node --import tsx tests/e2e/tournament-smoke.ts
```

This starts actual Next development pages, Chrome, a local HTTPS proxy, and an in-memory PGlite database using the real migrations. A test-only HTTP adapter simulates Supabase Auth and forwards the application's RPC calls to that database. Two separate browser cookie sessions represent synthetic players. No production account or database credential is needed.

Prerequisites: installed Chrome and Git's native OpenSSL (`C:/Program Files/Git/mingw64/bin/openssl.exe`) on Windows. Override `CHROME_PATH` or `OPENSSL_PATH` when needed. Windows network isolation can deny localhost connections with `EACCES`; the test then needs an execution environment that permits loopback communication. The script does not install or trust certificates in the operating system.

The test binds every server to `127.0.0.1`. A preload blocks nonlocal Node fetches; Chrome blocks external DNS. The OAuth callback is verified and redirected to the local test receiver instead of contacting Claude. It creates a one-day local TLS certificate under the ignored output directory. Next and browser processes are stopped in `finally`.

Consent uses an unmodified native browser POST. The local HTTPS proxy changes only the verified outbound callback destination after Next processes that POST. The earlier smoke run used Playwright `route.fetch` for consent, which masked the browser's `Origin` behavior and missed the `Referrer-Policy: no-referrer` failure. Its OAuth result did not establish native form compatibility.

Run the focused native form regression without Next:

```powershell
node --import tsx tests/e2e/oauth-consent-origin.ts
```

It serves the actual OAuth HTML with synthetic in-memory storage and compares the old `no-referrer` policy against the product policy for both approval and connection revocation. Chrome sends `Origin: null` and receives 403 in both old-policy controls, then sends the exact origin and receives 303 with `same-origin`. No browser requests are intercepted. The HTTPS handler verifies and replaces the external callback after the real consent handler responds; no request reaches Claude. Output is `test-results/oauth-consent-origin/evidence.json`.

Covered flows:

1. Friendly starter form → exact rule review → owner publication.
2. Separate browser accounts explicitly accept and enroll themselves.
3. Real-profile browser sessions → reviewed roster on Admin → generated match → direct provisional score on Matches; no account-free guest form.
4. Simulated 502 after administrator validation → original receipt recovery → final first/second places on Standings.
5. Dynamic OAuth client registration → native browser consent → 303 GET callback → opaque token → native revocation → refresh rejection.
6. Native Admin resolves existing usernames and enrolls two existing local profile identities through the real command/SQL boundary. Blank entry names, duplicate existing entries and full capacity disable submission; stored membership admission is administrator-sourced with no fabricated consent or new auth accounts.
7. The same OAuth client explicitly reconsents to administrator scope. A separate cookie-free HTTP MCP context lists administrator tools, reads current authorized tournament state, saves a real result through command/SQL, replays its receipt once, and verifies final placements. Opaque tokens stay only in memory.
8. A separate intercepted read-only snapshot fixture renders two entries sharing third place. This is presentation evidence, not a tournament-engine result.

`test-results/tournament-smoke/evidence.json` records the result and evidence limits. `synthetic-shared-third.png` is a full-page render. Logs and test certificates remain in the same ignored directory.

These checks verify local UI and real SQL behavior with simulated authentication. Actual Google login, hosted Supabase behavior, and account connections from ChatGPT/Claude require separate hosted checks.
