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

| English Term          | Japanese Term     | Status               | Notes                                                                                                          |
| --------------------- | ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Well-formed           | 整形式            | Agreed               | XML syntax conforms to W3C XML 1.0 well-formedness rules.                                                      |
| Well-formedness check | 整形式チェック    | Agreed               | Checking syntactic well-formedness only (no schema).                                                           |
| Validation            | 検証 / 妥当性検査 | **Undecided (未決)** | Both 「検証」 and 「妥当性検査」 are candidates; maintainer decision pending (`IMPLEMENTATION_PLAN.md` §10.7). |
| Schema                | スキーマ          | Agreed               | XSD, DTD, RELAX NG, or Schematron schema files.                                                                |
| Namespace             | 名前空間          | Agreed               | XML Namespace URI and prefix mapping.                                                                          |
| Attribute             | 属性              | Agreed               | XML element attribute.                                                                                         |
| Element               | 要素              | Agreed               | XML element node.                                                                                              |
| Diagnostic            | 診断              | Agreed               | Structured error, warning, or informational message.                                                           |
| Project               | プロジェクト      | **Undecided (未決)** | Domain container for XML files, catalogs, and validation/transformation scenarios (`ADR-0008`).                |
| Resource              | リソース          | **Undecided (未決)** | External/local schema, stylesheet, catalog, or XML target resolved via `ResourceResolver` (`ADR-0009`).        |
| Catalog               | カタログ          | **Undecided (未決)** | OASIS XML Catalog mapping URIs, system IDs, and public IDs (`ADR-0009`).                                       |
