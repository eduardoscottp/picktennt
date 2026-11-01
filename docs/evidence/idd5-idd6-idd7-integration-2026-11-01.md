# Integrated IDD-5, IDD-6 and IDD-7 release

The previous individual-slots deployment used commit `977a9fe` without the uncommitted authentication changes. This branch preserves that commit and restores the authentication source from the original application checkout, excluding unrelated documentation deletions and local credentials.

- IDD-7: individual registration slots, shared commands and existing migration remain in the branch ancestry.
- IDD-5: email signup, confirmation, password recovery, safe return paths, profile preservation and Google PKCE initialization fix.
- IDD-6: branded authentication screens and provider icons.
- Vercel project: existing `picktennt-bw9r`; explicit webpack build configuration retained.
- Verification: 315 tournament tests and 15 authentication tests pass in the isolated integration checkout. ESLint reports zero errors and 190 existing warnings.
- Previous public deployment: `dpl_3hyrZNdmoLXKtL2j6owq1xoQsaxb`.
- Integrated candidate: `dpl_FxaiSryXbT3rxZCf2RBoUP4Mtiyn`.

No database migration or provider credential change is part of this recovery. Apple client credential rejection remains a separate unresolved incident; restoring the UI does not establish a successful Apple token exchange or native account continuity.
