# Security Policy

> **Draft (English only) — `needs-ja-review`:** Japanese translation is pending.

## Security & Privacy Model

XMLens is a 100% client-side static web application:

- **No network calls or telemetry:** The application sends no analytics, crash reports, or user documents to any server. All XML processing stays inside your browser.
- **Strict Content Security Policy (CSP):** `packages/app/index.html` enforces `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `object-src 'none'`, and `base-uri 'self'`, with no external CDNs or fonts.
- **Untrusted XML input:** XML documents are treated as untrusted input. Parsers and validators must not fetch external entities or DTDs (XXE protection) and must enforce size/entity-expansion limits and worker timeouts.
- **Sandboxed output:** Transformed HTML / XSLT output must be rendered in a sandboxed iframe, never injected directly into the main application DOM.
- **Untrusted imported projects & offline resource model:** v1 performs no external network resource fetching, and `allowExternalEntities` remains hard-off (never a user setting). Imported project manifests (`xmlens.project.json`) and archives are untrusted: they cannot grant security permissions and may only lower resource limits. Archive/directory imports enforce path normalization, zip-slip/zip-bomb defenses, and case-collision warnings (`ADR-0008`, `ADR-0009`).
- **Browser persistence & GitHub Pages origin model:** When hosted on shared `<user>.github.io` project origins, browser storage (`IndexedDB`, `localStorage`) is same-origin-readable by sibling repositories published under the same account (custom domains isolate origins). To mitigate browser eviction of `IndexedDB` project data, XMLens will request `navigator.storage.persist()` where supported and pair local persistence with user project export.

## Supported Versions

XMLens is currently pre-1.0 (Milestone M0). Security fixes are applied on `main` and deployed to GitHub Pages.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for suspected security vulnerabilities (including XSS, CSP bypasses, XXE / entity-expansion DoS, or supply-chain issues).

Instead:

1. Use **GitHub Private Vulnerability Reporting** (Security advisories on the repository's **Security** tab) if enabled on the repository.
2. If private reporting is unavailable, contact the repository maintainers privately before disclosing details publicly (maintainer contact details to be finalized before v1.0).

Please include:

- A clear description of the vulnerability and potential impact
- Minimal reproduction steps or sample input
- Browser/environment details (if applicable)
