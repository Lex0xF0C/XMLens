/**
 * Pure TypeScript, DOM-free RFC 3986 URI reference parser and resolver (Spike R1).
 *
 * Implements:
 * - RFC 3986 §3 / Appendix B component parsing (`parseUri`)
 * - RFC 3986 §5.2.2 Transform References (`resolveReference`, strict mode by default)
 * - RFC 3986 §5.2.3 Merge Paths (`mergePaths`)
 * - RFC 3986 §5.2.4 Remove Dot Segments (`removeDotSegments`)
 * - RFC 3986 §5.3 Component Recomposition (`recomposeUri`)
 *
 * Out of scope / unimplemented in this spike:
 * - RFC 3986 §6.2.2 syntax-based normalization and §6.2.3 scheme-based normalization
 * - RFC 3987 IRI-to-URI percent-encoding or character-validity rejection
 */

/**
 * Five URI reference components per RFC 3986 §3 and Appendix B.
 * Preserves the distinction between an undefined component (delimiter absent)
 * and an empty-string component (delimiter present with zero content).
 */
export interface ParsedUri {
  readonly scheme: string | undefined;
  readonly authority: string | undefined;
  readonly path: string;
  readonly query: string | undefined;
  readonly fragment: string | undefined;
}

export interface ResolveReferenceOptions {
  readonly strict?: boolean;
}

/**
 * RFC 3986 Appendix B regular expression for breaking down a URI reference.
 * Capture groups:
 *   $2 = scheme, $4 = authority, $5 = path, $7 = query, $9 = fragment.
 */
const RFC3986_APPENDIX_B_RE = /^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#([\s\S]*))?/;

/**
 * Parses a URI reference into its five RFC 3986 components per Appendix B.
 */
export function parseUri(ref: string): ParsedUri {
  const match = RFC3986_APPENDIX_B_RE.exec(ref);
  if (!match) {
    return {
      scheme: undefined,
      authority: undefined,
      path: '',
      query: undefined,
      fragment: undefined,
    };
  }

  return {
    scheme: match[2],
    authority: match[4],
    path: match[5] ?? '',
    query: match[7],
    fragment: match[9],
  };
}

/**
 * Removes "." and ".." complete path segments per RFC 3986 §5.2.4.
 */
export function removeDotSegments(path: string): string {
  let input = path;
  let output = '';

  while (input.length > 0) {
    // Step 2A: strip leading "../" or "./"
    if (input.startsWith('../')) {
      input = input.slice(3);
      continue;
    }
    if (input.startsWith('./')) {
      input = input.slice(2);
      continue;
    }

    // Step 2B: replace leading "/./" or complete "/." segment with "/"
    if (input.startsWith('/./')) {
      input = '/' + input.slice(3);
      continue;
    }
    if (input === '/.') {
      input = '/';
      continue;
    }

    // Step 2C: replace leading "/../" or complete "/.." segment with "/"
    // and pop the last segment (plus preceding "/") from output.
    if (input.startsWith('/../') || input === '/..') {
      input = input.startsWith('/../') ? '/' + input.slice(4) : '/';
      const lastSlash = output.lastIndexOf('/');
      output = lastSlash >= 0 ? output.slice(0, lastSlash) : '';
      continue;
    }

    // Step 2D: remove sole "." or ".."
    if (input === '.' || input === '..') {
      input = '';
      continue;
    }

    // Step 2E: move first path segment (including optional leading "/") to output
    const searchFrom = input.startsWith('/') ? 1 : 0;
    const nextSlash = input.indexOf('/', searchFrom);
    if (nextSlash === -1) {
      output += input;
      input = '';
    } else {
      output += input.slice(0, nextSlash);
      input = input.slice(nextSlash);
    }
  }

  return output;
}

/**
 * Merges a relative-path reference with a base URI's path per RFC 3986 §5.2.3.
 */
export function mergePaths(base: ParsedUri, relativePath: string): string {
  if (base.authority !== undefined && base.path === '') {
    return '/' + relativePath;
  }

  const lastSlash = base.path.lastIndexOf('/');
  if (lastSlash === -1) {
    return relativePath;
  }
  return base.path.slice(0, lastSlash + 1) + relativePath;
}

/**
 * Recomposes parsed URI components into a URI reference string per RFC 3986 §5.3.
 */
export function recomposeUri(components: ParsedUri): string {
  let result = '';

  if (components.scheme !== undefined) {
    result += components.scheme + ':';
  }
  if (components.authority !== undefined) {
    result += '//' + components.authority;
  }
  result += components.path;
  if (components.query !== undefined) {
    result += '?' + components.query;
  }
  if (components.fragment !== undefined) {
    result += '#' + components.fragment;
  }

  return result;
}

/**
 * Resolves a URI reference `ref` against a `base` URI per RFC 3986 §5.2.2.
 * Uses strict mode by default (`options?.strict ?? true`).
 */
export function resolveReference(
  base: string,
  ref: string,
  options?: ResolveReferenceOptions,
): string {
  const strict = options?.strict ?? true;
  const baseParts = parseUri(base);
  const rawRefParts = parseUri(ref);

  const refScheme =
    !strict && rawRefParts.scheme === baseParts.scheme ? undefined : rawRefParts.scheme;

  let targetScheme: string | undefined;
  let targetAuthority: string | undefined;
  let targetPath: string;
  let targetQuery: string | undefined;

  if (refScheme !== undefined) {
    targetScheme = refScheme;
    targetAuthority = rawRefParts.authority;
    targetPath = removeDotSegments(rawRefParts.path);
    targetQuery = rawRefParts.query;
  } else {
    if (rawRefParts.authority !== undefined) {
      targetAuthority = rawRefParts.authority;
      targetPath = removeDotSegments(rawRefParts.path);
      targetQuery = rawRefParts.query;
    } else {
      if (rawRefParts.path === '') {
        targetPath = baseParts.path;
        targetQuery = rawRefParts.query !== undefined ? rawRefParts.query : baseParts.query;
      } else {
        if (rawRefParts.path.startsWith('/')) {
          targetPath = removeDotSegments(rawRefParts.path);
        } else {
          targetPath = removeDotSegments(mergePaths(baseParts, rawRefParts.path));
        }
        targetQuery = rawRefParts.query;
      }
      targetAuthority = baseParts.authority;
    }
    targetScheme = baseParts.scheme;
  }

  return recomposeUri({
    scheme: targetScheme,
    authority: targetAuthority,
    path: targetPath,
    query: targetQuery,
    fragment: rawRefParts.fragment,
  });
}
