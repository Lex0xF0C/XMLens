import { describe, expect, it } from 'vitest';
import { formatMessage, type MessageCatalog } from './index';

const en: MessageCatalog = {
  'preview.valid': 'Well-formed XML ({count} elements, root: <{root}>).',
  'fallback.only': 'English fallback message',
};

const ja: MessageCatalog = {
  'preview.valid': '整形式の XML です (要素数: {count}、ルート要素: <{root}>)。',
};

describe('formatMessage', () => {
  it('replaces named placeholders in the active catalog', () => {
    expect(formatMessage(ja, en, 'preview.valid', { count: 4, root: 'act' })).toBe(
      '整形式の XML です (要素数: 4、ルート要素: <act>)。',
    );
  });

  it('falls back to the English catalog when a key is missing in the active locale', () => {
    expect(formatMessage(ja, en, 'fallback.only')).toBe('English fallback message');
  });

  it('returns the key itself when missing from both catalogs', () => {
    expect(formatMessage(ja, en, 'unknown.key')).toBe('unknown.key');
  });

  it('keeps unprovided placeholders intact', () => {
    expect(formatMessage(en, en, 'preview.valid', { count: 2 })).toBe(
      'Well-formed XML (2 elements, root: <{root}>).',
    );
  });
});
