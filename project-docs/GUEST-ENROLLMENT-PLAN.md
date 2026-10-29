# Historical administrator guest enrollment — superseded

Current requirement (28 October 2026): every new player must have a real Picktennt account, profile, and DUPR identity. Name-only guest enrollment is withdrawn. Historical guest records remain readable and are not converted into accounts or personal-consent records. See [REAL-ACCOUNT-ENROLLMENT.md](REAL-ACCOUNT-ENROLLMENT.md).

The following records the earlier implementation and release; it is not the current enrollment policy.

Administrators may register singles or fixed-doubles guest entries on the existing Admin view while registration is open. A guest has a generated tournament participant UUID and display name, stored on its entry; no authentication account, profile, fabricated consent or invitation is created. Guest entry enrollment is bound to the published definition and recorded in the normal operation audit. Entries are approved by the administrator within capacity.

Reuse the existing command/CAS/idempotent receipt transaction and bracket engine. Runtime player identity includes guest UUIDs so doubles validation, scheduling, correction and final placements work normally. Guests cannot sign in or confirm scores; administrators validate their results. Registered-account enrollment and partner consent remain unchanged.

After registration closes or fixtures lock, additions are rejected and the UI is absent. Structural roster changes remain a separate reviewed intervention. This increment does not broaden existing OAuth scopes.

Verification: owner/delegated-admin authorization; participant/connector denial; exact singles/doubles roster size and definition binding; capacity/deadline/state rejection without residue; real SQL replay; no new accounts/consents; all-guest tournament completion and final placements; normal website roster form; preserve existing completed user event during migration/deployment.

Released 28 October 2026: migration005 and deployment dpl_Av5PSqsFvRZUfwpR3W2cBCiNrrGn. All172 tests and ten local browser cases passed. Production completed-event Admin rendering and preservation were checked without mutating the event.
