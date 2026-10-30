/// <reference types="jest" />

import { whenSettled } from '../../utils/settles';

describe('whenSettled', () => {
  it('hands over a value at once', () => {
    const then = jest.fn();

    whenSettled(3, then);

    expect(then).toHaveBeenCalledWith(3);
  });

  it('hands over what a promise resolves to, once it does', async () => {
    const then = jest.fn();

    await whenSettled(Promise.resolve(3), then);

    expect(then).toHaveBeenCalledWith(3);
  });

  it('hands over nothing from a promise that rejects', async () => {
    const then = jest.fn();

    await whenSettled(Promise.reject(new Error('refused')), then);

    expect(then).not.toHaveBeenCalled();
  });
});
