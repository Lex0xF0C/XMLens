import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkChangelog } from './check-changelog.mjs';

const VALID_SAMPLE = `# Changelog

## [Pending]

(none)

## [DEV-0002] - 2026-11-26

- **Sync:** direct

### Added

- Added something.

## [DEV-0001] - Baseline

Baseline note.

### Added

- Initial baseline.
`;

describe('checkChangelog', () => {
  it('accepts valid Pending, DEV-0002+, and DEV-0001 Baseline entries', () => {
    expect(checkChangelog(VALID_SAMPLE)).toEqual([]);
  });

  it('rejects duplicate DEV numbers and malformed DEV headings', () => {
    const duplicate = VALID_SAMPLE.replace(
      '## [DEV-0001] - Baseline',
      '## [DEV-0002] - 2026-11-25\n\n- **Sync:** direct',
    );
    const dupErrors = checkChangelog(duplicate);
    expect(dupErrors.some((msg) => msg.includes('Duplicate DEV number DEV-0002'))).toBe(true);

    const shortDigits = `# Changelog

## [Pending]

(none)

## [DEV-12] - 2026-11-26

- **Sync:** direct
`;
    const malformedErrors = checkChangelog(shortDigits);
    expect(malformedErrors.some((msg) => msg.includes('Malformed DEV heading'))).toBe(true);
  });

  it('requires DEV headings to be strictly descending even across release headings', () => {
    const outOfOrder = `# Changelog

## [Pending]

(none)

## [DEV-0001] - Baseline

## [v1.0.0] - 2026-11-26

Includes: DEV-0001 … DEV-0002

## [DEV-0002] - 2026-11-26

- **Sync:** direct
`;
    const errors = checkChangelog(outOfOrder);
    expect(errors.some((msg) => msg.includes('strictly descending'))).toBe(true);

    const validWithRelease = `# Changelog

## [Pending]

(none)

## [DEV-0003] - 2026-11-27

- **Sync:** direct

## [v1.0.0] - 2026-11-27

Includes: DEV-0001 … DEV-0002

## [DEV-0002] - 2026-11-26

- **Sync:** PR #5

## [DEV-0001] - Baseline
`;
    expect(checkChangelog(validWithRelease)).toEqual([]);
  });

  it('rejects [Unreleased] and missing [Pending] headings', () => {
    const withUnreleased = VALID_SAMPLE.replace('## [Pending]', '## [Unreleased]');
    const errors = checkChangelog(withUnreleased);
    expect(errors.some((msg) => msg.includes('[Unreleased]'))).toBe(true);
    expect(errors.some((msg) => msg.includes('Missing required "## [Pending]"'))).toBe(true);
  });

  it('validates DEV dates including (UTC), date-unknown, leap years, and rejects invalid dates', () => {
    const validDates = `# Changelog

## [Pending]

(none)

## [DEV-0004] - date-unknown

- **Sync:** direct

## [DEV-0003] - 2026-11-27 (UTC)

- **Sync:** direct

## [DEV-0002] - 2024-02-29

- **Sync:** direct

## [DEV-0001] - Baseline
`;
    expect(checkChangelog(validDates)).toEqual([]);

    const missingDate = `# Changelog

## [Pending]

(none)

## [DEV-0002]

- **Sync:** direct
`;
    expect(checkChangelog(missingDate).some((msg) => msg.includes('must have date suffix'))).toBe(
      true,
    );

    const badCalendarDate = `# Changelog

## [Pending]

(none)

## [DEV-0002] - 2026-02-29

- **Sync:** direct
`;
    expect(
      checkChangelog(badCalendarDate).some((msg) => msg.includes('invalid calendar date')),
    ).toBe(true);

    const badMonth = `# Changelog

## [Pending]

(none)

## [DEV-0002] - 2026-13-01

- **Sync:** direct
`;
    expect(checkChangelog(badMonth).some((msg) => msg.includes('invalid calendar date'))).toBe(
      true,
    );
  });

  it('requires non-empty - **Sync:** on DEV-0002+ while allowing Baseline DEV-0001 without Sync', () => {
    const missingSync = `# Changelog

## [Pending]

(none)

## [DEV-0002] - 2026-11-26

### Added

- Missing sync line.

## [DEV-0001] - Baseline
`;
    expect(checkChangelog(missingSync).some((msg) => msg.includes('missing a "- **Sync:**'))).toBe(
      true,
    );

    const emptySync = `# Changelog

## [Pending]

(none)

## [DEV-0002] - 2026-11-26

- **Sync:**   
`;
    expect(checkChangelog(emptySync).some((msg) => msg.includes('empty "- **Sync:**" value'))).toBe(
      true,
    );
  });

  it('validates release headings, Includes separators, range ordering, and referenced DEV existence', () => {
    const validRanges = `# Changelog

## [Pending]

(none)

## [v1.2.0] - 2026-11-27

Includes: DEV-0003 ... DEV-0004

## [DEV-0004] - 2026-11-27

- **Sync:** direct

## [v1.1.0] - 2026-11-27

Includes: DEV-0002 - DEV-0003

## [DEV-0003] - 2026-11-27

- **Sync:** direct

## [v1.0.0] - 2026-11-26

Includes: DEV-0001

## [DEV-0002] - 2026-11-26

- **Sync:** direct

## [DEV-0001] - Baseline
`;
    expect(checkChangelog(validRanges)).toEqual([]);

    const missingIncludes = `# Changelog

## [Pending]

(none)

## [v1.0.0] - 2026-11-26

Summary without includes.

## [DEV-0001] - Baseline
`;
    expect(
      checkChangelog(missingIncludes).some((msg) => msg.includes('missing an "Includes:')),
    ).toBe(true);

    const invertedRange = `# Changelog

## [Pending]

(none)

## [v1.0.0] - 2026-11-26

Includes: DEV-0002 … DEV-0001

## [DEV-0002] - 2026-11-26

- **Sync:** direct

## [DEV-0001] - Baseline
`;
    expect(
      checkChangelog(invertedRange).some((msg) => msg.includes('inverted Includes range')),
    ).toBe(true);

    const unknownDevInIncludes = `# Changelog

## [Pending]

(none)

## [v1.0.0] - 2026-11-26

Includes: DEV-0001 … DEV-0099

## [DEV-0001] - Baseline
`;
    expect(
      checkChangelog(unknownDevInIncludes).some((msg) => msg.includes('non-existent DEV-0099')),
    ).toBe(true);
  });

  it('normalizes CRLF line endings identically to LF', () => {
    const crlf = VALID_SAMPLE.replace(/\n/g, '\r\n');
    expect(checkChangelog(crlf)).toEqual([]);
  });

  it('ignores headings inside triple-or-more backtick code fences', () => {
    const withFencedExamples = `# Changelog

## [Pending]

(none)

## [DEV-0002] - 2026-11-26

- **Sync:** direct

\`\`\`markdown
## [Unreleased]
## [DEV-0099]
## [v9.9.9]
\`\`\`

\`\`\`\`markdown
## [DEV-12]
\`\`\`\`

## [DEV-0001] - Baseline
`;
    expect(checkChangelog(withFencedExamples)).toEqual([]);
  });

  it('passes against the repository CHANGELOG.md', () => {
    const actualChangelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    expect(checkChangelog(actualChangelog)).toEqual([]);
  });
});
