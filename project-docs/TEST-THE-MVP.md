# Test the Picktennt MVP

Website: https://app.picktennt.com/tournaments/build

MCP address: `https://app.picktennt.com/api/mcp`

The release reuses Picktennt's website, database and Google login. Every player must have a real Picktennt profile. Enrollment preserves that profile's identity and DUPR links; it does not create substitute accounts or invent DUPR information. DUPR submission still needs its existing separate identity/submission checks.

## Connect or reconnect Claude

Reconnect Picktennt using the MCP address and automatic OAuth registration. Sign in with your existing Picktennt administrator account. The live final release adds a separate `tournaments:owner` permission alongside draft and administration permissions. Review the consent screen's explicit owner actions and approve **Allow owner actions**. Existing draft/admin connections do not gain owner permission automatically.

Keep client-secret and custom-header fields empty. Enable Picktennt in the Claude conversation. A compatible ChatGPT custom MCP connection uses the same address and OAuth flow; client/account eligibility and actual onboarding must be checked separately.

## First tournament

Ask the assistant to prepare the tournament and return the owner review link. Review and publish the rules on the website, or—with newly consented owner permission—ask the assistant to preview publication, show the exact rules and warnings, obtain your confirmation and publish the reviewed draft.

Players can join using their own accounts. Alternatively, open **Admin → Register existing Picktennt players**, look up their exact Picktennt usernames and enroll the returned profiles. For doubles select two distinct existing accounts. Administrator enrollment is recorded separately from personal acceptance.

With the new permission, ask Claude:

> Use Picktennt to read my tournament at [paste tournament URL]. Show the current players and matches. Look up the Picktennt usernames I provide before enrolling anyone. Do not create accounts or guest players. Before changing fixtures, qualification or results that affect other games, show me the impact and ask whether to proceed.

The assistant can manage registration, review and lock the roster, activate the tournament, save/validate results, resolve ties and disputes, change available courts, and preview/apply corrections or withdrawals. Current role, revision and permission checks apply to every action. The separate owner permission adds reviewed publication, cancellation, reopening completed results and adding/removing existing account holders as tournament administrators. It works only for the current tournament owner. Every owner mutation requires a fresh impact preview and your explicit confirmation; delegated administrators cannot gain ownership or remove the owner.

## Scores and final places

Enter a legal completed score and choose **Save & Validate**, or ask the assistant to save the reported score. No Start game click or minimum-rest wait is required. The web validation note is optional; the assistant records a short administrator reason. Scores must still follow the published target/win-by rules, and semifinal results must be validated before final/bronze participants resolve.

For an accepted-score correction, review the concrete affected fixtures/results first. Started or accepted downstream results require explicit replay handling. Structural assistant commands require confirmation and a current revision/impact preview.

A four-player full round robin plus semifinals, final and bronze has ten games. When all required results are accepted, **Standings → All placements** shows champion, second, third and fourth. The earlier round-robin rankings are separate from these final placements.

Revoke assistant access at https://app.picktennt.com/oauth/connections. Revocation stops assistant reads, writes and receipt recovery; native website access remains governed by your current account role.

## Verification boundary

BUILD-STATUS.md distinguishes automated tests, local native-browser/OAuth/MCP/SQL evidence, hosted deployment and actual external Claude/ChatGPT account tests. A deployment does not prove a fresh external connection. The completed user tournament is preserved.
