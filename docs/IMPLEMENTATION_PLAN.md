# XMLens — Implementation Plan

> **Working name:** `XMLens` (placeholder; the final name must not resemble any existing commercial product or trademark).
> **Status:** Draft v0.1 — 2026-11-23
> **License:** MIT · **Deployment:** GitHub Pages (static, client-side only)
> **Languages:** English (primary), Japanese (secondary)

## 0. 概要 / Summary (日本語)

商用XMLエディタが提供するような「XML開発支援」と「XML構造の可視化」を、ブラウザだけで動く MIT ライセンスの静的サイトとして作る計画です。サーバ不要・アップロード不要(ファイルは端末から出ない)で、GitHub Pages に配備します。対象は、商用ライセンスを負担しにくい OSS コミュニティや個人で、LegalDocML(Akoma Ntoso)、LegalRuleML、CVRF/CSAF などのXML仕様を扱う人です。UIは英語を基本とし、日本語を第二言語として最初から i18n 設計に組み込みます。

既存の商用製品を**コピーするのではなく、一般的な機能カテゴリを調査して独自に再実装**します(コード・UI・アイコン・ドキュメント文面は流用しません)。ブラウザで現実的なもの(編集、整形式/XSD/Schematron検証、XPath、XSLT、構造可視化、差分)を優先し、重い機能(完全なXSLTデバッガ、XMLデータベース連携、DITA出版)は当面スコープ外とします。

**設計方針の更新(XSLT関連):** ブラウザ内蔵のXSLT(`XSLTProcessor`)は、Chrome等で削除が進んでおり、当てにしません。XSLT 2.0/3.0は、Saxonica社のSaxonJS(オープンソースではないが、変更なしの再配布は条件付きで許可)を**任意プラグインとして同梱**して対応します(既定はオフ、ビルド時に取得して変更せず配置、リポジトリにはコミットしない)。ライセンス条件4(第三者への提供が主目的のサイトへのコピー禁止)については、「本サイトはXMLエディタというアプリケーションであり、ソフトウェア頒布サイトではない」という解釈に基づき、**書面での許諾を取らずに進める**とメンテナが判断しました(ADR-0002に根拠と前提を記録)。この解釈が崩れないよう、SaxonJSを単体でダウンロードさせる導線や複製(ミラー)を作らない運用ルールを設けます。SaxonJSのブラウザ版は**コンパイル済み(SEF形式)のスタイルシートを実行する設計**で、編集中のXSLTをブラウザ内でコンパイルできるかは未確認のため、最初にスパイクで確かめます。

**設計方針の補足(XML Project・リソース解決):** 複数ファイル、OASIS XML Catalog、検証/変換シナリオは **XML Project** として統合し、共通の Resource Resolver が事前収集した不変の `ResourceBundle` を介して Worker 内エンジンへ渡します(ADR-0008 / ADR-0009)。v1 では外部ネットワークからの自動取得を行わず、Project 内ファイル、Profile Pack、およびユーザー添付で解決します。

---

## 1. Goals and non-goals

### Goals
1. A **zero-cost, zero-install** XML workbench usable by volunteers and small OSS projects.
2. **Visualize XML structure** better than a plain text editor: tree, outline, statistics, namespace map, schema diagrams, dependency graphs.
3. **Develop and debug XML-based standards**: validate (XSD / DTD / Schematron), query (XPath), transform (XSLT), compare (structural diff).
4. **Privacy by design**: all processing is local in the browser. No telemetry, no uploads. This matters for legal, security-advisory, and pre-publication standards work.
5. **Bilingual from day one**: English UI and docs are the source of truth; Japanese is complete at each release.
6. **Accessible and European-friendly**: WCAG 2.2 AA target (relevant to EU accessibility requirements), keyboard-first, no external CDN dependencies at runtime (GDPR-friendly).

### Non-goals (initial releases)
- Reproducing WYSIWYG "author mode" editing, DITA publishing, WebHelp, or review/collaboration servers.
- XML database connectors (MarkLogic, BaseX, eXist, etc.). Browser CORS and credentials make this impractical for a static site.
- A full step-through XSLT/XQuery debugger (see §4, P3).
- Server-side features, accounts, cloud storage.
- Copying any code, UI layout, icons, text, or documentation from any proprietary product.

---

## 2. Legal and licensing guardrails

| Topic | Rule |
|---|---|
| Our license | MIT for all original code and docs. |
| Clean-room | Derive requirements from public feature descriptions and from the W3C/OASIS specs only. Do not decompile, copy screenshots, or copy documentation wording. |
| Trademarks | Do not use the name, logo, or distinctive branding of any commercial XML editor in the product name, UI, docs, or marketing. Do not name specific commercial products as the basis of this project in public materials. |
| Dependency policy | Allowed: MIT, BSD-2/3, ISC, Apache-2.0, 0BSD, CC0, Unlicense. **MPL-2.0 only with maintainer approval** (file-level copyleft; fine as an unmodified dependency). **Forbidden:** GPL, AGPL, LGPL (static bundling), SSPL, "source-available" licenses. |
| Saxonica SaxonJS | **Not open source**; governed by the "Saxon-JS Public License v1.0 (June 2020)" (covers `saxon-js`, `xslt3` on npm and `SaxonJS2.js` / `SaxonJS2.rt.js`). Our reading (not legal advice): execution on client computers is permitted; **unmodified binary redistribution as part of an application** is permitted if (1) the copyright notice and disclaimer are reproduced in documentation, (2) no reverse engineering/decompilation, (3) the licensor's name is not used to endorse/promote our product, (4) the software is **not copied to a site whose primary purpose is to make it available to third parties** without written permission. **Decision: bundle as an optional, off-by-default plugin** — see §5.5 for mechanics. **Maintainer decision (ADR-0002): proceed without requesting written permission**, on the reading that our site is an XML editor application and not a site whose primary purpose is to make the software available to third parties. This is the maintainers' interpretation, not legal advice; the residual risk is accepted and mitigated by the compliance posture in §5.5 (no standalone download path, no mirror, off by default, one-switch removal). The license text is version-specific: re-check the license of the exact version we pin (e.g., a 3.x beta may differ). |
| Bundled schemas | Bundle a standard's XSD/Schematron/catalog files **only** if its license permits redistribution; record license + source URL + version in `profiles/<name>/PROVENANCE.md`. Otherwise reference by URL and let the user upload the file. |
| License audit | CI runs a license checker and fails on non-allowed licenses. `THIRD_PARTY_NOTICES.md` is generated at build time. |

---

## 3. Commercial XML editor feature survey → our scope

Sources: publicly available product pages, user guides, and datasheets of commercial XML editors (source list kept in the maintainers' private notes, not in this repository). Items marked † come from general knowledge and should be re-verified against public feature matrices before the plan is finalized.

Priority legend: **P0** = MVP · **P1** = v1.0 · **P2** = after v1.0 · **P3** = stretch · **OUT** = not planned.

### 3.1 Editing

| Reference capability | Our equivalent | Browser feasibility | Priority |
|---|---|---|---|
| Text editing mode with syntax coloring, folding, tag matching | CodeMirror 6 XML mode, folding, matching, multi-cursor | Easy | P0 |
| Well-formedness checking while typing | Incremental parse in worker, inline diagnostics | Easy | P0 |
| Format / pretty-print / indent, whitespace options | Formatter with configurable indent, attribute wrapping, preserve-space aware | Easy | P0 |
| Content completion driven by schema | XSD-driven element/attribute/enum completion | Medium | P1 |
| Grid mode (nested table view) † | Read/write table view for repetitive structures | Medium | P2 |
| Schema Design mode (visual XSD editing) | Read-only XSD diagram first; editing later | Medium–Hard | P1 (view) / P3 (edit) |
| Author mode (CSS-based WYSIWYG) | — | Hard | OUT |
| Code templates, snippets | Snippet library, user-defined, import/export JSON | Easy | P1 |
| Multi-file project view, search & replace across files | Project (IndexedDB primary; opt-in File System Access API / `webkitdirectory` import) | Medium | P1 |
| XML refactoring actions † | Rename element/namespace prefix, wrap/unwrap, sort attributes | Medium | P2 |
| Encoding / Unicode handling | UTF-8/16 detection, BOM handling, clear CJK support | Easy | P0 |

### 3.2 Validation

| Reference capability | Our equivalent | Feasibility | Priority |
|---|---|---|---|
| XML Schema (XSD) validation | libxml2 compiled to WebAssembly (XSD 1.0) | Medium | P0 |
| DTD validation | libxml2 WASM | Medium | P1 |
| Schematron validation | Own Schematron interpreter evaluating rules directly with the XPath engine (no XSLT needed; proposed, see spike S3). Supports `let`, patterns/rules/assert/report, abstract patterns, SVRL output. XPath 3.1 binding via the XPath engine. Alternative: compile via ISO Schematron XSLT skeleton (XPath 1.0 rules only) or via SaxonJS when the plugin is enabled | Medium | P1 |
| RELAX NG validation | Research WASM options (e.g., a libxml2 RelaxNG build or Jing port); license check required | Hard | P2 |
| XSD 1.1 (assertions) | No mature MIT browser engine known; document limitation | Hard | OUT (revisit) |
| XML Catalogs (OASIS) resolution | Shared in-browser catalog & Resource Resolver feeding `ResourceBundle` | Medium | P0 |
| Validation scenarios (saved schema + options per file) | Saved validation scenarios in Project | Easy | P1 |

### 3.3 Querying and transformation

> **Note (2026-11):** Chrome's published plan removes XSLT (`XSLTProcessor` and the XSLT processing instruction) from Stable releases, with Firefox and WebKit also signalling removal; a WASM polyfill is mentioned. We therefore do **not** rely on browser-native XSLT. Verify current status of each browser before M4.

| Reference capability | Our equivalent | Feasibility | Priority |
|---|---|---|---|
| XPath evaluator / XPath Builder | XPath panel: native XPath 1.0; XPath 3.1 via a permissively licensed JS engine (candidate: `fontoxpath` — verify license/version); results highlighted in editor and tree | Easy–Medium | P0 (1.0) / P1 (3.1) |
| XSLT 1.0 transformation | Default engine decided by spike S2 (candidate: a WASM build of libxslt, which is MIT-licensed — verify the specific package and its license). Native `XSLTProcessor` is **not** relied upon. If no suitable engine is found, XSLT 1.0 is provided through the SaxonJS plugin only | Medium | P0 (spike) / P1 |
| XSLT 2.0/3.0 transformation | Bundled optional **SaxonJS plugin** (off by default, §5.5). Browser build executes **compiled SEF** stylesheets; in-browser compilation of user-edited XSLT is **unconfirmed** (spike S1). Fallback: user precompiles with the free `xslt3` CLI (XX compiler) and loads the `.sef.json` | Medium | P1 (after S1) |
| Transformation scenarios | Saved scenarios in Project (input, stylesheet, parameters, output view) | Easy | P1 |
| XSLT/XQuery debugger (breakpoints, call stack, trace) | Lightweight alternative: trace panel (matched templates, `xsl:message`), template-coverage highlight. Full debugger deferred | Hard | P3 |
| XQuery editing/execution | Evaluate a permissively licensed XQuery engine later | Hard | P3 |
| Profiler | — | Hard | OUT |

### 3.4 Visualization (our differentiator)

| Feature | Description | Priority |
|---|---|---|
| Synchronized tree view | Collapsible tree ↔ editor cursor sync, XPath breadcrumb | P0 |
| Outline / structure stats | Element/attribute frequency, depth histogram, namespace inventory, size hot-spots | P0 |
| Large-document mode | Streaming outline + read-only virtualized view for big files | P1 |
| Treemap / sunburst of document | Visual size & structure overview | P1 |
| Schema (XSD) diagram | Elements, complex types, groups, extension/restriction relationships | P1 |
| Dependency graph | `xs:import` / `xs:include` / `xsl:import` / `xsl:include` / catalog graph | P1 |
| Reference graph | `ID`/`IDREF`, `href`/`xlink`, Akoma Ntoso `eId`/`wId` cross-references with broken-link detection | P1 |
| Structural diff view | Tree-aware diff (ignores whitespace and attribute order optionally) | P1 |
| Rule/norm graph (LegalRuleML profile) | Show norms, rules, and relationships | P2 |
| Export | SVG / PNG export of diagrams | P1 |

### 3.5 Documentation and conversion

| Reference capability | Our equivalent | Priority |
|---|---|---|
| XSD documentation generator | HTML/Markdown documentation generated from XSD annotations | P2 |
| XSLT documentation | Same approach for stylesheets | P3 |
| Generate sample XML from XSD | Minimal and "maximal" sample instance generator | P2 |
| Convert XML ↔ JSON | Configurable converter; round-trip warnings | P2 |
| Convert schema formats (DTD/XSD/RNG) † | — | OUT |
| Import from CSV/Excel † | CSV → XML via mapping template | P3 |

### 3.6 Integration and collaboration

| Reference capability | Our equivalent | Priority |
|---|---|---|
| Git/SVN client, review/comment tools | None; use external Git. "Copy as patch-friendly format" only | OUT |
| XML databases, WebDAV, SharePoint | — | OUT |
| Dedicated JSON editor | JSON Schema validation is a possible later module, since CSAF 2.x is JSON | P3 |
| Share link | Encode small samples into URL fragment (no server) | P2 |

### 3.7 New, AI-era features (beyond typical XML editors)

| Feature | Description | Priority |
|---|---|---|
| **LLM-output validator** | Paste XML produced by an LLM; validate against a chosen XSD/Schematron profile; produce a concise, copyable "repair report" (errors with XPath + line + expected content). Runs locally; no LLM calls are made by the app. | P1 |
| Schema-to-prompt helper | Export a compact structural summary of an XSD (allowed children, required attributes, enums) suitable for pasting into a prompt | P2 |
| Bilingual alignment view (for XLIFF/parallel text) | Side-by-side source/target segment view | P3 |

---

## 4. Domain profiles ("Profile Packs")

A profile pack is a folder under `profiles/<id>/` containing: manifest (`profile.json`), catalog, schemas (if redistributable), Schematron rules, sample documents, and a `PROVENANCE.md`. Profile packs integrate as read-only Project layers in resource resolution (`Catalog → Project files → Profile Pack → User-attached file → Unresolved`).

| Profile | Standard | Notes |
|---|---|---|
| `akn` | LegalDocML / Akoma Ntoso (OASIS) | Schema validation, `eId`/`wId`/`href` reference checks, structure outline by hierarchy (part/chapter/article/paragraph). Verify schema redistribution terms. |
| `legalruleml` | LegalRuleML (OASIS) | Schema validation, norm/rule graph. |
| `cvrf` / `csaf` | CVRF 1.x (XML) and CSAF | **Note:** CSAF 2.x is JSON-based; the XML predecessor is CVRF. Plan: CVRF as XML profile in the first phase; CSAF JSON support via a later JSON Schema module (P3) if the community wants it. Confirm intended scope with the maintainers. |
| `xliff` | XLIFF 1.2/2.x | Useful for translation workflows. |
| `generic` | W3C XSD, XSLT, Schematron files | Editing support for schema languages themselves. |

Because browsers enforce CORS and our v1 security posture avoids unsolicited outbound requests, **v1 performs no external network resource fetching**. Instead, schemas and catalogs are resolved from: (1) bundled redistributable Profile Packs, (2) files inside the local Project, and (3) user upload / drag-and-drop attachment mapped into a local catalog, with a clear unresolved diagnostic otherwise. Any future opt-in external fetch would require an ADR and a CSP `connect-src` update.

---

## 5. Architecture

### 5.1 Principles
- **Static only.** `vite build` outputs a folder deployable to GitHub Pages, including under a sub-path (`/xmlens/`). All asset URLs are relative or use Vite's `base`.
- **Local only.** No network requests at runtime except explicit user actions. Strict CSP in `index.html` (`default-src 'self'`; WASM allowed via `wasm-unsafe-eval` only if required).
- **Workers for heavy work.** Parsing, validation, XPath, and transformation run in Web Workers with timeouts and cancellation so the UI never freezes.
- **Core is UI-agnostic.** `packages/core` (pure TypeScript, no DOM) can later be reused in a CLI or VS Code extension.
- **Progressive enhancement.** File System Access API where available (Chromium); fall back to upload/download elsewhere (Firefox, Safari).

### 5.2 Proposed stack (record as ADR-0001; revisit if justified)

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) | Safety, agent-friendly |
| Build | Vite | Static output, simple Pages deploy |
| UI | Preact + signals (alternative: Svelte) | Small bundle |
| Editor | CodeMirror 6 + `@codemirror/lang-xml` | Handles large docs, extensible, MIT |
| XML parsing | `saxes` 6.0.0 in `@xmlens/core` (worker-executed, ADR-0003; native `DOMParser` was an M0 placeholder only); `libxml2-wasm` or `xmllint-wasm` for XSD/DTD validation (`xmllint-wasm` is MIT per npm; verify current package + libxml2 license before adoption) | Worker-safe well-formedness (`saxes`); standards-compliant XSD 1.0 |
| XPath 1.0 | Native `document.evaluate` | No dependency |
| XPath 3.1 | `fontoxpath` candidate (verify) | Permissive license |
| XSLT 1.0 | WASM libxslt-based engine (spike S2); no reliance on native `XSLTProcessor` | Browser XSLT is being removed |
| Schematron | Own interpreter on the XPath engine (spike S3); optional SaxonJS-based path | Avoids XSLT 2.0+ dependency for the default build |
| XSLT 2.0/3.0 (optional) | SaxonJS plugin, self-hosted unmodified, build-time fetched (§5.5) | Only non-OSI component; isolated and off by default |
| Visualization | Custom SVG tree + D3 modules (ISC) for treemap/sunburst; Cytoscape.js (MIT) or ELK-based layout for graphs (verify) | Interactive and exportable |
| i18n | ICU MessageFormat-style JSON catalogs (e.g., `@formatjs`) | Plurals and Japanese support |
| Tests | Vitest (unit), Playwright (e2e + a11y via axe) | Standard |
| Lint/format | ESLint, Prettier, `tsc --noEmit` | CI gates |

### 5.3 Repository layout

```
/
├─ AGENTS.md
├─ LICENSE                      # MIT
├─ THIRD_PARTY_NOTICES.md       # generated
├─ README.md / README.ja.md
├─ docs/
│  ├─ IMPLEMENTATION_PLAN.md
│  ├─ adr/                      # architecture decision records
│  ├─ feature-matrix.md         # our scope vs. surveyed capabilities
│  └─ i18n-guide.md
├─ packages/
│  ├─ core/                     # pure TS: parse, validate, xpath, diff, stats
│  ├─ project/                  # pure TS: Project model, catalogs, URI/resolver, bundle (planned; created before M3)
│  ├─ workers/                  # worker entrypoints & RPC
│  ├─ viz/                      # visualization components
│  └─ app/                      # Vite app (UI, i18n, routing, storage adapters)
├─ profiles/                    # profile packs (akn, legalruleml, cvrf, xliff, ...)
├─ locales/
│  ├─ en.json                   # source of truth
│  └─ ja.json
├─ tests/
│  ├─ fixtures/                 # XML/XSD/XSLT test data (with licenses)
│  └─ e2e/
└─ .github/workflows/           # ci.yml, pages.yml, license-check.yml
```

### 5.4 Key technical risks and mitigations

| Risk | Mitigation |
|---|---|
| Large XML files (10–100+ MB) freeze the tab | Size tiers: normal (<5 MB, full features), large (5–50 MB, deferred parsing + virtualized view), huge (>50 MB, read-only streaming outline). Document limits. |
| XML entity expansion attacks ("billion laughs") on parse | Cap entity expansion and memory (WASM memory limits, worker timeouts); never fetch external entities. |
| Browser-native XSLT is being removed (and was XSLT 1.0 only) | Do not depend on it; spike S2 for a WASM XSLT 1.0 engine; document limits in UI; track browser status. |
| SaxonJS browser build cannot compile user-edited XSLT | Spike S1. Fallbacks: precompiled `.sef.json` workflow with the free `xslt3` CLI; or limit plugin to running SEF files. Do not reverse engineer or modify the library. |
| Saxonica license interpretation (condition 4) or a change of the license | Accepted risk (ADR-0002) with the compliance posture in §5.5; license text hash pinned so a changed license fails the build; one-switch removal flag; prompt takedown if the licensor objects. |
| Schema redistribution licenses | Provenance files + CI check that every bundled schema has an entry. |
| CORS / external schema URLs | Upload-first workflow, Project attachments, and bundled catalogs; no external network fetching in v1 (any future change requires an ADR and CSP `connect-src` update). |
| Sync WASM/JS engines vs. async browser storage | Two-phase `ResourceBundle` built asynchronously on the main/project layer and passed as an immutable `Uint8Array` snapshot to Web Workers (ADR-0009). Dynamic runtime URIs outside the bundle emit explicit `"unresolved"` diagnostics. |
| Untrusted imported projects / manifests | `xmlens.project.json` stores intent only (never permissions or `files[]`); manifest limits may only lower app caps; ZIP imports enforce zip-slip, zip-bomb, cycle, depth, and byte limits. |
| Browser storage eviction & GitHub Pages origin sharing | `navigator.storage.persist()` plus export workflow (M5) mitigate IndexedDB eviction; `SECURITY.md` documents shared `<user>.github.io` origin vs. custom domain isolation. |
| Case-insensitive filesystems & archive paths | Normalize paths (Unicode NFC, separators), treat internal project paths as case-sensitive, and warn on case-folded collisions during import. |
| Japanese IME/CJK edge cases in editor | Dedicated e2e tests with IME composition; verify fonts and line-break behavior. |
| Scope creep toward a "full commercial IDE clone" | Feature matrix with priorities; every P2+ item requires an issue + ADR. |

---

### 5.5 SaxonJS plugin design

- **Development environment constraint:** day-to-day development happens in **Google AI Studio with its automatic GitHub integration pushing to the public repository**. We do **not know** whether that integration honors `.gitignore`, so `.gitignore` is treated as a convenience only, never as the protection. The protection is that **the SaxonJS files never exist in the AI Studio workspace at all** (see next bullet), plus a CI guard that fails if they ever appear in git.
- **Acquisition (CI-only, no npm dependency):** `saxon-js` is **not** listed in `package.json` (not in `dependencies`, `devDependencies`, or `optionalDependencies`) and is not in the lockfile, so `npm ci` in AI Studio or on any developer machine never downloads it. Instead, `scripts/fetch-plugins.mjs` runs **only inside GitHub Actions** (it refuses to run unless `GITHUB_ACTIONS=true`). It downloads the pinned version with `npm pack saxon-js@<version>`, verifies the tarball's SHA-512 integrity against `plugins/saxonjs/pinned.json` (exact version + integrity; this small metadata file is the only thing committed), extracts the documented distribution file(s) and license text, and copies them **unmodified** into `dist/plugins/saxonjs/` **after** the Vite build. Files in `dist/plugins/` are never passed through the bundler, minifier, or tree-shaker. `dist/` is never committed (deployment is by Actions).
- **Repository guard (CI):** `scripts/check-no-third-party-binaries.mjs` runs on every push/PR and fails the build if any **tracked** file (`git ls-files`) matches `*saxon*` (case-insensitive path) other than the allowlisted metadata (`plugins/saxonjs/pinned.json`, `plugins/saxonjs/APPROVED_LICENSE.sha256`, files under `docs/`), contains the vendor's copyright line in a non-doc file, or lies under `node_modules/` or `dist/`. A failing guard blocks the Pages deployment. Because the AI Studio sync may push before CI runs, a maintainer must also **inspect the repository on GitHub after the first sync and after any change to build/plugin scripts**, and remove (and purge from history if needed) any file that should not be there.
- **`.gitignore` (belt and braces):** includes `node_modules/`, `dist/`, `plugins/saxonjs/*.js`, `**/SaxonJS*`, `**/saxon-js*`. Do not rely on it.
- **License pinning:** the build compares the shipped license text against an approved hash stored in `plugins/saxonjs/APPROVED_LICENSE.sha256`; any difference fails the build until a maintainer re-reviews it (ADR-0002).
- **Notices:** the About page and `THIRD_PARTY_NOTICES.md` reproduce the copyright notice and disclaimer. Do not use the licensor's name to endorse or promote the product; factual attribution only.
- **Off by default:** the user enables "XSLT 2.0/3.0 (SaxonJS)" in settings; the file is then loaded from our own origin (no third-party request). The UI states clearly that this component is third-party, not open source, and under its own license.
- **Isolation:** run in a sandboxed iframe or dedicated worker (decide in spike S1), talking to the app through typed `postMessage`. The strict CSP of the main app stays unchanged.
- **Execution model (from the vendor documentation):** the browser build is designed to run stylesheets already compiled to SEF (JSON). Node.js can execute XSLT directly and export SEF. Two compilers exist: XJ (Java, part of the commercial Saxon-EE) and XX (written in XSLT, shipped with SaxonJS, free; it relies on JavaScript extension functions for XPath parsing). The XX compiler's XSLT source is for subscribers only, so we treat the library as a black box.
- **Modes, in order of preference (subject to spike S1):** (A) compile in the browser if the shipped browser build supports it; (B) the user compiles with the `xslt3` CLI and loads `.sef.json` into the tool, which runs it; (C) if neither works, the plugin is dropped from v1.0 and XSLT 2.0/3.0 is documented as unsupported.
- **Separation of concerns:** XPath 3.1 in the XPath panel and Schematron come from our own XPath engine, not from SaxonJS, so the default build keeps full XPath 3.1 without the plugin.
- **Compliance posture (keeps the "application, not distribution site" reading credible):** (1) the plugin is part of the editor and used by it; there is **no page, link, README text, release asset, or package** that offers the SaxonJS file as a download or presents the site as a way to obtain it; (2) no separate repository, branch, GitHub release, or npm package of ours contains or re-publishes it; (3) it is off by default and the app is fully usable without it; (4) the directory is not advertised, listed, or documented as a download location; (5) a build flag (`XMLENS_BUNDLE_SAXONJS`, default on for the official build) removes the plugin entirely so it can be dropped in one release if the licensor objects or the license changes; (6) maintainers monitor the pinned version's license and respond promptly to any request from the licensor. Sending Saxonica a courtesy notice or question later is optional and not a gate.
- **Forks:** the build always places the license and notice files next to the plugin, so forks deploying their own Pages site also meet the notice condition. Forks remain responsible for their own compliance.

### 5.6 XML Project and Resource Resolution (accepted direction: ADR-0008, ADR-0009; gated on R1 / extended S4)

- **Unified Project model:** Multi-file projects, OASIS XML Catalogs, and validation/transformation scenarios are unified under **Project** (`ADR-0008`, replacing the earlier "Workspace" term). File payloads are stored as `Uint8Array` bytes so non-UTF-8 encodings stay intact until decoding.
- **Manifest & storage layering:** `xmlens.project.json` (`schemaVersion`) stores root entries, catalog pointers, scenarios, role overrides, and optional lowered limits—never a `files[]` inventory and never security permissions. Browser persistence adapters (IndexedDB primary; opt-in File System Access API and `webkitdirectory` import) reside in `packages/app`, behind a pure `ProjectFileSystem` interface in planned `packages/project` (`lib: ["ES2022"]`, acyclic dependency direction `core ← project ← workers ← app`).
- **Two-phase `ResourceBundle` & split resolver API:** `ResourceResolver.locate()` runs synchronously and purely against in-memory catalogs (returning canonical URIs + trace), while `load()` and bundle building run asynchronously with cycle/depth/byte caps and `AbortSignal`. Workers and validation/XSLT engines receive immutable `ResourceBundle` snapshots over RPC and never touch IndexedDB or network URLs.
- **URI identity & RFC 3986 resolution:** Open documents carry stable URIs from M1 (`untitled:1`) distinct from storage paths. Relative references resolve against `baseUri` via a self-written DOM-free RFC 3986 §5 resolver before XML Catalog lookup (`Catalog → Project → Profile Pack → User-attached → Unresolved`).
- **Strict v1 security posture:** No external network fetching in v1, `allowExternalEntities` stays hard-off (not user-configurable), imported manifests/archives are untrusted, and browser IP/localhost SSRF blocklists are avoided as non-boundaries.


## 6. Internationalization (English primary, Japanese secondary)

- All user-visible strings come from `locales/en.json`; **no literals in components**. Keys are semantic (`validation.error.line`), never sentences.
- `ja.json` must have **100% key parity** at release time. CI fails on missing/extra keys; untranslated keys fall back to English at runtime with a dev warning.
- Support plurals and number/date formatting through the Intl APIs; Japanese needs no plural forms but the message format must handle it.
- Error messages from underlying engines (libxml2, browser parsers) are English-only; wrap them with localized context and show the raw message in a collapsible detail.
- Docs: `README.md` (en) and `README.ja.md`; user guide in both languages; terminology glossary in `docs/i18n-guide.md` (e.g., "well-formed" = 整形式, "validation" = 検証/妥当性検査 — decide one and record it).
- Language switch: auto-detect from `navigator.language`, persisted choice, URL parameter `?lang=ja`.
- Architecture allows adding further languages (e.g., German, French) without code changes — useful for European users.

---

## 7. Quality bar

- **Accessibility:** WCAG 2.2 AA; full keyboard operation; screen-reader labels for tree/graph views (tree uses ARIA tree pattern; graphs offer a textual/table alternative); respects `prefers-reduced-motion` and color-contrast; high-contrast theme.
- **Performance budgets (initial targets):** first load ≤ 1.5 MB gzipped JS+WASM excluding optional plugins; typing latency < 50 ms on a 1 MB document; validation of a 5 MB document does not block the main thread.
- **Security:** CSP, no `eval`, no inline scripts, sanitized rendering of XSLT output (render in sandboxed iframe), dependency audit in CI.
- **Third-party plugin isolation:** the SaxonJS plugin runs sandboxed and only when enabled; it receives only the documents the user passes to it.
- **Testing:** unit tests for core; golden-file tests for formatter, diff, and Schematron/SVRL; e2e for open→edit→validate→visualize→export; cross-browser (Chromium, Firefox, WebKit) in Playwright.
- **Documentation:** each feature ships with an English doc page and Japanese translation.

---

## 8. Milestones

Each milestone ends with a tagged release deployed to GitHub Pages and an updated `docs/feature-matrix.md`.

### S — Spikes (before or alongside M0 / M3)
- **S1 (SaxonJS):** in the pinned version, (a) does the browser build expose a compile step for user-edited XSLT; (b) can it run in a sandboxed iframe/worker; (c) size and load time; (d) `.sef.json` workflow with the `xslt3` CLI as fallback.
- **S2 (XSLT 1.0 default engine):** evaluate WASM libxslt-based packages/polyfills: license, size, maintenance, browser support, correctness on a conformance sample.
- **S3 (Schematron):** prototype an interpreter on the XPath engine against a few real rule sets; compare with the ISO Schematron XSLT skeleton route.
- **S4 (WASM XSD validation & Bundle execution, extended for M3):** compare `xmllint-wasm` vs `libxml2-wasm` with a multi-file XSD, OASIS XML Catalog, and prebuilt `ResourceBundle` (preloaded virtual FS vs synchronous hooks).
- **S5 (large files):** CodeMirror 6 with a 5 MB document and worker-parsed outline.
- **R1 (URI & OASIS XML Catalog 1.1 conformance, before M3):** verify self-written DOM-free RFC 3986 §5 resolver against RFC 3986 §5.4 test vectors, and verify OASIS XML Catalogs 1.1 `system`/`public`/`prefer`/`xml:base`/`rewrite*`/`nextCatalog` precedence directly from the OASIS specification text.
- **Acceptance:** each spike ends with a short ADR (decision, evidence, license facts) before related milestone work begins.

### M0 — Foundation (≈1–2 weeks)
- Repo scaffolding, MIT license, `AGENTS.md`, ADR-0001 (stack), CI (lint, typecheck, test, license check), Pages deploy workflow with sub-path support.
- i18n skeleton with `en`/`ja`, language switcher, key-parity check.
- App shell: layout, theme (light/dark/high-contrast), CSP.
- **Acceptance:** blank app deploys to Pages in both languages; CI green; license check enforced; the repository guard is active and has been verified to catch a deliberately added `saxon-test.js` on a throwaway branch.

### M1 — Editor core (≈2–3 weeks)
- Open/save/drag-drop, tabs (with stable document URI identities such as `untitled:1`), UTF-8/16 + BOM, CodeMirror setup, folding, tag matching, snippets (basic).
- Worker-based well-formedness diagnostics with line/column; error list with click-to-jump.
- Formatter (pretty-print) with options; XPath breadcrumb for cursor.
- **Acceptance:** edit a 1 MB file smoothly; malformed XML shows localized diagnostics within 300 ms of pause.

### M2 — Visualization v1 (≈2–3 weeks)
- Synchronized tree view; outline; statistics (element/attribute frequency, depth, namespaces).
- Treemap/sunburst; SVG/PNG export.
- Large-file tiers.
- **Acceptance:** tree↔editor sync on 5 MB file; stats panel for 20 MB file via streaming; keyboard and screen-reader operable tree.

### M3 — Validation & Project Foundation (≈3–4 weeks)
- Create `packages/project` (planned before M3, DOM-free `ES2022`).
- **P0:** Resource Resolver (`URI` resolution, synchronous `locate()`, `ResourceBundle` builder) and OASIS XML Catalogs 1.1 initial subset resolution; XSD 1.0 validation via WASM consuming `ResourceBundle`; error list mapped to editor and tree.
- **P1:** Project model (`xmlens.project.json` intent manifest, byte-level `ProjectFileSystem`), IndexedDB storage adapter in `packages/app`, minimal Project Explorer, saved validation scenarios, DTD validation, Schematron via own interpreter on the XPath engine (per spike S3) + SVRL viewer.
- **Acceptance:** validate against a multi-file XSD (import/include) with catalog via `ResourceBundle`; Project persists across reloads in IndexedDB; Schematron report grouped by rule; LLM-output "repair report" export (P1 feature).

### M4 — XPath and XSLT (≈2–3 weeks)
- XPath panel (1.0 native, 3.1 engine), result highlighting in editor and tree.
- XSLT scenarios (stored in Project, inputs supplied via `ResourceBundle`) using the default engine chosen in S2 (1.0); output preview (sandboxed), parameters.
- SaxonJS plugin (XSLT 2.0/3.0) per §5.5 and spike S1, once S1 shows a workable execution mode (A or B). Ship disabled-by-default and follow the compliance posture in §5.5.
- Trace panel (matched templates, `xsl:message`).
- **Acceptance:** saved scenarios persist; XPath results navigable; XSLT output safely rendered.

### M5 — Schema, Project Portability, and Structural Visualization (≈3 weeks)
- XSD diagram; dependency graph (driven by `ReferenceExtractor` / Resource Resolver over `xs`/`xsl`/`sch`/catalog references); reference graph with broken-link detection.
- Opt-in File System Access API adapter (`packages/app`) + `<input webkitdirectory>` fallback and **P1** ZIP import/export with security hardening (zip-slip/zip-bomb/path-normalization/case-collision warnings).
- Structural XML diff.
- XSD-driven completion in the editor.
- **Acceptance:** diagram renders a real-world XSD (e.g., Akoma Ntoso) responsively; diff ignores configured noise; ZIP round-trip preserves Project bytes and manifest.

### M6 — Profile packs (≈2–3 weeks)
- `akn`, `legalruleml`, `cvrf`, `xliff`, `generic` profiles integrated as read-only Project layers with provenance records.
- Profile-specific checks and outline (e.g., Akoma Ntoso hierarchy; LegalRuleML norm view as P2).
- **Acceptance:** each profile has sample docs, passing tests, and license provenance.

### M7 — v1.0 hardening (≈2 weeks)
- Full a11y audit, performance pass, cross-browser fixes, PWA/offline, complete Japanese docs and UI, security review, contributor guide.
- **Acceptance:** all P0/P1 items done or explicitly deferred with issues; Lighthouse a11y ≥ 95; no open high-severity bugs.

### After v1.0 (P2/P3 candidates)
Grid mode, refactoring actions, RELAX NG, XSD documentation generator, sample-instance generator, XML↔JSON, CSAF JSON support, schema editing, share links, lightweight XSLT debugger.

---

## 9. Contribution and governance
- Issues labeled by priority (`P0`–`P3`) and area (`editor`, `viz`, `validation`, `xslt`, `profiles`, `i18n`, `a11y`).
- Non-trivial design changes require an ADR in `docs/adr/`.
- Contributor guide and Code of Conduct (Contributor Covenant); DCO sign-off (preferred over a CLA to keep friction low).
- Translation contributions welcome; additional languages follow the same key-parity rule.

---

## 10. Open decisions (need maintainer input)

1. **Project name and repository owner/org** (final name; domain/Pages path).
2. **UI framework — Decided (provisional, 2026-11-27):** Draft `docs/adr/0015-ui-framework.md` (`Status: Proposed`) before M2 comparing Preact + signals vs. Svelte vs. current plain TypeScript DOM (maintainer provisional leaning: Preact + signals; no packages installed yet).
3. **Which validation WASM package** (`libxml2-wasm` vs. `xmllint-wasm`) after a short spike comparing browser support, size, maintenance, and license.
4. **SaxonJS optional plugin:** decided — bundle, off by default (§5.5); proceed without written permission per ADR-0002. Open: behavior of the license for the exact version we pin; whether in-browser compile works (spike S1).
5. **CSAF scope — Decided (provisional, 2026-11-27):** v1 supports CVRF (XML) only; CSAF 2.x (JSON / JSON Schema) will be reconsidered post-v1 as a P3 module.
6. **Profile redistribution:** confirm licenses of OASIS schemas (Akoma Ntoso, LegalRuleML) for bundling versus upload-only.
7. **Japanese terminology** (整形式 / 妥当性検査 etc.) glossary approval.
8. **Telemetry — Decided (provisional, 2026-11-27):** None; no analytics (including privacy-preserving analytics) will be introduced.
9. **Default XSLT 1.0 engine** after spike S2 (WASM libxslt-based package) or SaxonJS-only.
10. **Schematron approach** after spike S3 (own interpreter vs. XSLT skeleton).
11. **`xmlens.project.json` manifest schema details** (`schemaVersion` 1 fields for scenarios, catalog entries, and optional lowered limits — before M3).
12. **ZIP library candidate** for M5 import/export: license verification (`AGENTS.md` §4.1.3 / §4.1.7), bundle size, and maintenance status (currently **unverified**).
13. **External network fetching — Decided (provisional, 2026-11-27):** Excluded in v1 per `ADR-0009` (no external fetching in v1; any future post-v1 opt-in requires a dedicated ADR and CSP `connect-src` revision).

---

## 11. Immediate next steps

1. Review §10 and answer at least items 1–3.
2. Record the SaxonJS decision and its rationale (reading of condition 4, accepted risk, compliance posture) in ADR-0002 and `docs/legal/`.
3. Create the repository with the MIT license, `AGENTS.md`, and this plan.
4. Run spikes S1–S5; write ADR-0001 (stack) and ADR-0002 (SaxonJS plugin) from the results.
5. Start M0; before M3, review proposed `ADR-0008` / `ADR-0009` and run Spike R1 plus extended Spike S4.
