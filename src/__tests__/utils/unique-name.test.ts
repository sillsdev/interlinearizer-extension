import { uniqueDefaultName } from '../../utils/unique-name';

describe('uniqueDefaultName', () => {
  it('returns the filled default template when no name matches it', () => {
    expect(
      uniqueDefaultName(['Other', undefined], 'Copy of {name}', 'Copy ({number}) of {name}', {
        name: 'X',
      }),
    ).toBe('Copy of X');
  });

  it('returns the first filled numbered template, counting from 2, that no name matches', () => {
    expect(
      uniqueDefaultName(
        ['Copy of X', 'Copy (2) of X'],
        'Copy of {name}',
        'Copy ({number}) of {name}',
        { name: 'X' },
      ),
    ).toBe('Copy (3) of X');
  });

  it('fills templates with no replacements when none are given', () => {
    expect(uniqueDefaultName(['Copy of X'], 'Copy of X', 'Copy ({number}) of X')).toBe(
      'Copy (2) of X',
    );
  });
});
