/// <reference types="jest" />

import { altKeyHint, resolvedOrEmpty } from '../../utils/localized-strings';
import { pretendMacOs } from '../test-helpers';

describe('altKeyHint', () => {
  it('names the Alt key off a Mac', () => {
    expect(altKeyHint('Hold Alt', 'Hold Option')).toBe('Hold Alt');
  });

  it('names the Option key on a Mac', () => {
    pretendMacOs();
    expect(altKeyHint('Hold Alt', 'Hold Option')).toBe('Hold Option');
  });
});

describe('resolvedOrEmpty', () => {
  it('returns an empty string for an unresolved %…% key', () => {
    expect(resolvedOrEmpty('%interlinearizer_glossInput_placeholder%')).toBe('');
  });

  it('does not treat a string with only an initial percent sign as a key', () => {
    expect(resolvedOrEmpty('% interest?')).toBe('% interest?');
  });

  it('does not treat a string with only a final percent sign as a key', () => {
    expect(resolvedOrEmpty('complete: 50%')).toBe('complete: 50%');
  });
});
