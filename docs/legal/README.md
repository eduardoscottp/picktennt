# iOS legal publication

Source: Claude legal handoff `af4db470332e6c97681732217df2d7675c3f4bca`, with proposed engineering corrections and an explicit marketing-consent decision pending. Review Markdown lives in `content/legal/ios`; `scripts/legal/build-documents.mjs` produces the JSON rendered by the website without introducing a Markdown dependency.

Public routes after approval: `/policy`, `/ios/terms`, `/ios/privacy`. Preserve existing Android `/privacy`. The pages use the existing Next.js/Vercel deployment and require no authentication. iOS signup and Settings point at these exact HTTPS URLs.

Before production:

1. Obtain the publication decision for the exact corrected text, including optional marketing. Keep the source legal-review limitations visible to the operator.
2. Record the approval and actual effective date. Update both Markdown sources and `content/legal/ios/publication.json`; remove review markers only after approval. Keep version aligned with iOS `PicktenntLegal.revision`.
3. Run `node scripts/legal/build-documents.mjs`, `node scripts/legal/build-documents.mjs --check`, lint and production build.
4. Publish through the existing Vercel/GitHub workflow, then verify `/policy`, `/ios/terms`, `/ios/privacy`, `/privacy`, and `/support` anonymously over HTTPS.
5. Only then distribute the matching iPhone/Watch build and enter the privacy URL in App Store Connect.

`VERCEL_ENV=production` refuses to build while the effective date is unset. Local/preview builds display a review notice and `noindex`; approval plus a real date removes that notice. Source generation refuses a dated publication while draft markers remain.

The iOS-only agreement is not applied to Google signup for the tournament website. Web/Android legal scope needs its own review before changing that flow.
