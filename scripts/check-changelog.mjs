import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEV_HEADING_PREFIX_RE = /^##\s+(?:\[DEV\b|\bDEV\b)/i;
const STRICT_DEV_HEADING_RE = /^##\s+\[DEV-(\d{4})\](.*)$/;
const PENDING_HEADING_RE = /^##\s+\[Pending\](?:\s|$)/;
const UNRELEASED_HEADING_RE = /^##\s+\[Unreleased\](?:\s|$)/i;
const RELEASE_HEADING_RE = /^##\s+\[v(\d+)\.(\d+)\.(\d+)\](?:\s|$)/;
const CODE_FENCE_OPEN_RE = /^\s*(`{3,})/;
const CODE_FENCE_CLOSE_RE = /^\s*(`{3,})\s*$/;
const SYNC_LINE_RE = /^-\s+\*\*Sync:\*\*(.*)$/;
const INCLUDES_LINE_RE = /^Includes:\s*(.*)$/;
const SINGLE_INCLUDE_RE = /^DEV-(\d{4})$/;
const RANGE_INCLUDE_RE = /^DEV-(\d{4})(?:\s*…\s*|\s*\.\.\.\s*|\s+-\s+)DEV-(\d{4})$/;
const DATE_SUFFIX_RE = /^\s+-\s+(\d{4})-(\d{2})-(\d{2})(?:\s+\(UTC\))?\s*$/;

function isValidCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function validateDevDate(devNum, rest, lineNumber, headingLine, errors) {
  const trimmed = rest.trim();

  if (devNum === 1) {
    if (trimmed === '' || /^\s+-\s+Baseline\s*$/.test(rest)) {
      return;
    }
  }

  if (/^\s+-\s+date-unknown\s*$/.test(rest)) {
    return;
  }

  const dateMatch = DATE_SUFFIX_RE.exec(rest);
  if (!dateMatch) {
    const expected =
      devNum === 1
        ? '" - Baseline", " - YYYY-MM-DD", " - YYYY-MM-DD (UTC)", or " - date-unknown"'
        : '" - YYYY-MM-DD", " - YYYY-MM-DD (UTC)", or " - date-unknown"';
    errors.push(
      `Line ${lineNumber}: DEV heading "${headingLine}" must have date suffix ${expected}.`,
    );
    return;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (!isValidCalendarDate(year, month, day)) {
    errors.push(
      `Line ${lineNumber}: DEV heading "${headingLine}" has invalid calendar date ${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}.`,
    );
  }
}

/**
 * Parses and validates CHANGELOG.md content against ADR-0013 / AGENTS.md §12 rules.
 * Returns structured errors along with verified entry counts.
 */
export function inspectChangelog(text) {
  if (typeof text !== 'string') {
    return {
      errors: ['Changelog content must be a string.'],
      devCount: 0,
      releaseCount: 0,
    };
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');

  const sections = [];
  let currentSection = null;
  let inCodeFence = false;
  let fenceLength = 0;

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const line = rawLines[idx];
    const lineNumber = idx + 1;

    if (inCodeFence) {
      const closeMatch = CODE_FENCE_CLOSE_RE.exec(line);
      if (closeMatch && closeMatch[1].length >= fenceLength) {
        inCodeFence = false;
        fenceLength = 0;
      }
      continue;
    }

    const openMatch = CODE_FENCE_OPEN_RE.exec(line);
    if (openMatch) {
      inCodeFence = true;
      fenceLength = openMatch[1].length;
      continue;
    }

    if (line.startsWith('## ')) {
      currentSection = {
        headingLine: line,
        lineNumber,
        bodyLines: [],
      };
      sections.push(currentSection);
    } else if (currentSection !== null) {
      currentSection.bodyLines.push({ lineNumber, text: line });
    }
  }

  const errors = [];
  let pendingCount = 0;
  const devEntries = [];
  const releaseEntries = [];
  const seenDevNumbers = new Map();
  let previousDev = null;

  for (const section of sections) {
    const { headingLine, lineNumber } = section;

    if (UNRELEASED_HEADING_RE.test(headingLine)) {
      errors.push(
        `Line ${lineNumber}: Disallowed "[Unreleased]" heading "${headingLine}" found; use "## [Pending]" or "## [DEV-NNNN]".`,
      );
      continue;
    }

    if (PENDING_HEADING_RE.test(headingLine)) {
      pendingCount += 1;
      if (pendingCount > 1) {
        errors.push(`Line ${lineNumber}: Duplicate "## [Pending]" heading "${headingLine}".`);
      }
      continue;
    }

    const releaseMatch = RELEASE_HEADING_RE.exec(headingLine);
    if (releaseMatch) {
      releaseEntries.push(section);
      continue;
    }

    const strictDevMatch = STRICT_DEV_HEADING_RE.exec(headingLine);
    if (strictDevMatch) {
      const devId = `DEV-${strictDevMatch[1]}`;
      const devNum = Number(strictDevMatch[1]);
      const rest = strictDevMatch[2];

      if (seenDevNumbers.has(devNum)) {
        const firstLine = seenDevNumbers.get(devNum);
        errors.push(
          `Line ${lineNumber}: Duplicate DEV number ${devId} in "${headingLine}" (already defined at line ${firstLine}).`,
        );
      } else {
        seenDevNumbers.set(devNum, lineNumber);
      }

      if (previousDev !== null && devNum > previousDev.num) {
        errors.push(
          `Line ${lineNumber}: DEV headings must be strictly descending (${devId} appears below ${previousDev.id} at line ${previousDev.lineNumber}).`,
        );
      }
      previousDev = { num: devNum, id: devId, lineNumber };

      validateDevDate(devNum, rest, lineNumber, headingLine, errors);

      if (devNum !== 1) {
        const syncLine = section.bodyLines.find((entry) => SYNC_LINE_RE.test(entry.text));
        if (!syncLine) {
          errors.push(
            `Line ${lineNumber}: DEV entry "${headingLine}" is missing a "- **Sync:** <value>" line.`,
          );
        } else {
          const syncMatch = SYNC_LINE_RE.exec(syncLine.text);
          if (!syncMatch || syncMatch[1].trim() === '') {
            errors.push(
              `Line ${syncLine.lineNumber}: DEV entry "${headingLine}" has an empty "- **Sync:**" value.`,
            );
          }
        }
      }

      devEntries.push(section);
      continue;
    }

    if (DEV_HEADING_PREFIX_RE.test(headingLine)) {
      errors.push(
        `Line ${lineNumber}: Malformed DEV heading "${headingLine}"; expected "## [DEV-NNNN] - YYYY-MM-DD" with 4 zero-padded digits.`,
      );
    }
  }

  if (pendingCount === 0) {
    errors.push('Missing required "## [Pending]" heading.');
  }

  for (const release of releaseEntries) {
    const { headingLine, lineNumber, bodyLines } = release;
    const includesLine = bodyLines.find((entry) => INCLUDES_LINE_RE.test(entry.text));
    if (!includesLine) {
      errors.push(
        `Line ${lineNumber}: Release heading "${headingLine}" is missing an "Includes: DEV-xxxx … DEV-yyyy" line.`,
      );
      continue;
    }

    const includesMatch = INCLUDES_LINE_RE.exec(includesLine.text);
    const value = includesMatch ? includesMatch[1].trim() : '';

    const singleMatch = SINGLE_INCLUDE_RE.exec(value);
    const rangeMatch = RANGE_INCLUDE_RE.exec(value);

    let startNum;
    let endNum;
    let startId;
    let endId;

    if (singleMatch) {
      startId = `DEV-${singleMatch[1]}`;
      endId = startId;
      startNum = Number(singleMatch[1]);
      endNum = startNum;
    } else if (rangeMatch) {
      startId = `DEV-${rangeMatch[1]}`;
      endId = `DEV-${rangeMatch[2]}`;
      startNum = Number(rangeMatch[1]);
      endNum = Number(rangeMatch[2]);
    } else {
      errors.push(
        `Line ${includesLine.lineNumber}: Release heading "${headingLine}" has malformed Includes value "${value}" (expected "DEV-xxxx … DEV-yyyy" or "DEV-xxxx").`,
      );
      continue;
    }

    if (startNum > endNum) {
      errors.push(
        `Line ${includesLine.lineNumber}: Release heading "${headingLine}" has inverted Includes range (${startId} > ${endId}).`,
      );
    }

    if (!seenDevNumbers.has(startNum)) {
      errors.push(
        `Line ${includesLine.lineNumber}: Release heading "${headingLine}" references non-existent ${startId} in Includes.`,
      );
    }
    if (endNum !== startNum && !seenDevNumbers.has(endNum)) {
      errors.push(
        `Line ${includesLine.lineNumber}: Release heading "${headingLine}" references non-existent ${endId} in Includes.`,
      );
    }
  }

  return {
    errors,
    devCount: devEntries.length,
    releaseCount: releaseEntries.length,
  };
}

/**
 * Validates CHANGELOG.md text and returns an array of error messages (empty when valid).
 */
export function checkChangelog(text) {
  return inspectChangelog(text).errors;
}

function main() {
  const root = process.cwd();
  const changelogPath = join(root, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    console.error('CHANGELOG.md not found in workspace root.');
    process.exit(1);
  }

  const content = readFileSync(changelogPath, 'utf8');
  const { errors, devCount, releaseCount } = inspectChangelog(content);

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(err);
    }
    process.exit(1);
  }

  console.log(
    `Changelog check passed: verified ${devCount} DEV entry/entries and ${releaseCount} release heading(s).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
