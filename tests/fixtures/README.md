# XML Test Fixtures

All XML fixtures in this directory are self-authored specifically for XMLens automated testing and are distributed under the project's **MIT License** (`LICENSE`). None of these fixtures contain personal data, confidential content, or third-party copyrighted files.

| File                            | Purpose                                                                                                                       | Origin / License    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `valid-akn-cjk.xml`             | Well-formed Akoma Ntoso-style bilingual EN/JA XML with namespaces and CJK text                                                | Self-authored (MIT) |
| `valid-utf8-bom.xml`            | Well-formed XML beginning with a UTF-8 Byte Order Mark (`U+FEFF`)                                                             | Self-authored (MIT) |
| `dtd-internal-entity.xml`       | Well-formed XML with an internal `<!DOCTYPE>` entity declaration (`&title;`) to verify entity expansion remains disabled      | Self-authored (MIT) |
| `security-billion-laughs.xml`   | Nested internal entity-expansion attack pattern to verify bounded, non-expanding behavior                                     | Self-authored (MIT) |
| `encoding-iso8859-1.xml`        | Well-formed XML declaring `encoding="ISO-8859-1"` to verify encoding note diagnostics                                         | Self-authored (MIT) |
| `invalid-duplicate-attr.xml`    | Malformed XML with duplicate attributes on an element                                                                         | Self-authored (MIT) |
| `invalid-mismatched-tag.xml`    | Malformed XML with mismatched closing tags                                                                                    | Self-authored (MIT) |
| `invalid-unclosed-tag.xml`      | Malformed XML with an unclosed element at EOF                                                                                 | Self-authored (MIT) |
| `invalid-unbound-namespace.xml` | Malformed XML referencing an undeclared namespace prefix                                                                      | Self-authored (MIT) |
| `invalid-multiple-roots.xml`    | Malformed XML containing multiple root elements                                                                               | Self-authored (MIT) |
| `invalid-undefined-entity.xml`  | Malformed XML referencing an undeclared named entity                                                                          | Self-authored (MIT) |
| `invalid-astral-position.xml`   | Malformed XML containing a surrogate-pair character (`𠮷`, U+20BB7) before an error to verify UTF-16 offset vs Unicode column | Self-authored (MIT) |
