# Internationalization (i18n) Guide

This document defines the localization rules and terminology conventions for XMLens.

## 1. Supported Languages

- **Primary (source of truth):** English (`locales/en.json`)
- **Secondary (complete parity required):** Japanese (`locales/ja.json`)

Language selection order at runtime:

1. URL query parameter (`?lang=en` or `?lang=ja`)
2. Persisted user preference in `localStorage`
3. Browser `navigator.language` (falls back to `en`)

## 2. Rules for Contributors

1. **No user-visible string literals in components.** All UI text must reference semantic keys from `locales/en.json` (typed via `MessageKey` in `packages/app`).
2. **100% key and placeholder parity.** Every key added to or changed in `locales/en.json` must be updated in `locales/ja.json` in the same change.
3. **No empty strings.** Every key in both catalogs must have a non-empty string value.
4. **Placeholders.** Named placeholders use `{name}` syntax and must match identically between `en.json` and `ja.json`.
5. **Engine error messages.** Raw errors from XML/XSD/Schematron engines (which are English-only) must be wrapped in a localized message with `{detail}` and, when detailed views are added, shown in a collapsible raw detail section.
6. **Validation script.** Run `npm run i18n:check` (included in `npm run check`) to verify key parity, `{placeholder}` set parity, and non-empty values.

## 3. Terminology Glossary (English / Japanese)

Terms marked **Undecided (未決)** are awaiting final maintainer approval. Do not pick one term arbitrarily in UI strings until decided.

| English Term          | Japanese Term                     | Status               | Notes                                                                                                                                                                                            |
| --------------------- | --------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Well-formed           | 整形式                            | Agreed               | XML syntax conforms to W3C XML 1.0 well-formedness rules.                                                                                                                                        |
| Well-formedness check | 整形式チェック                    | Agreed               | Checking syntactic well-formedness only (no schema).                                                                                                                                             |
| Validation            | 検証 / 妥当性検査                 | **Undecided (未決)** | Both 「検証」 and 「妥当性検査」 are candidates; maintainer decision pending (`IMPLEMENTATION_PLAN.md` §10.7).                                                                                   |
| Schema                | スキーマ                          | Agreed               | XSD, DTD, RELAX NG, or Schematron schema files.                                                                                                                                                  |
| Namespace             | 名前空間                          | Agreed               | XML Namespace URI and prefix mapping.                                                                                                                                                            |
| Attribute             | 属性                              | Agreed               | XML element attribute.                                                                                                                                                                           |
| Element               | 要素                              | Agreed               | XML element node.                                                                                                                                                                                |
| Diagnostic            | 診断                              | Agreed               | Structured error, warning, or informational message.                                                                                                                                             |
| Project               | プロジェクト                      | **Undecided (未決)** | Domain container for XML files, catalogs, and validation/transformation scenarios (`ADR-0008`).                                                                                                  |
| Resource              | リソース                          | **Undecided (未決)** | External/local schema, stylesheet, catalog, or XML target resolved via `ResourceResolver` (`ADR-0009`).                                                                                          |
| Catalog               | カタログ                          | **Undecided (未決)** | OASIS XML Catalog mapping URIs, system IDs, and public IDs (`ADR-0009`).                                                                                                                         |
| Encoding              | 文字コード / 文字エンコーディング | **Undecided (未決)** | Character encoding label (`locales/ja.json` provisionally uses 「文字コード」 pending maintainer decision).                                                                                      |
| Line ending           | 改行コード                        | **Undecided (未決)** | Line-break convention (`LF` / `CRLF`); provisional translation pending maintainer review (`needs-ja-review`).                                                                                    |
| BOM                   | BOM（バイトオーダーマーク）       | **Undecided (未決)** | Unicode Byte Order Mark option in Save dialog; provisional translation pending review (`needs-ja-review`).                                                                                       |
| Format                | 整形                              | **Undecided (未決)** | XML pretty-print toolbar action (`ADR-0012`); kept as 「整形」 for now while remaining Undecided (alternative candidate: 「フォーマット」) due to visual similarity to 「整形式」 (Well-formed). |
| Indent                | インデント                        | **Undecided (未決)** | Indentation style selector (`2 spaces` / `4 spaces` / `Tab`); provisional translation (`needs-ja-review`).                                                                                       |
| Breadcrumb            | パンくず / パンくずリスト         | **Undecided (未決)** | Proposed terminology for the cursor element path (`statusBar.xpath` displays `XPath: {value}` directly without surfacing a Japanese translation yet).                                            |

Notes on UI terminology & units:

- **Format (「整形」) vs. Well-formed (「整形式」):** Because 「整形」 and 「整形式」 look visually similar, 「フォーマット」 remains an alternative candidate for Format. For now, XMLens keeps 「整形」 and retains **Undecided (未決)** status for Format.
- **"MB" size-limit wording:** UI messages such as `preview.tooLarge` and `preview.formatOutputTooLarge` display `{limitMb} MB` for consistency with existing messages, while the enforced threshold is `1 MiB` (`1,048,576` bytes).
