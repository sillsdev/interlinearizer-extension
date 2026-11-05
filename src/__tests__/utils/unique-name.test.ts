import { uniqueDefaultName } from '../../utils/unique-name';

const numbered = (number: number) => `Copy (${number}) of X`;

describe('uniqueDefaultName', () => {
  it('returns the default name when no name matches it', () => {
    expect(uniqueDefaultName(new Set(['Other', undefined]), 'Copy of X', numbered)).toBe(
      'Copy of X',
    );
  });

  it('returns the first numbered name, counting from 2, that no name matches', () => {
    expect(uniqueDefaultName(new Set(['Copy of X', 'Copy (2) of X']), 'Copy of X', numbered)).toBe(
      'Copy (3) of X',
    );
  });
});
