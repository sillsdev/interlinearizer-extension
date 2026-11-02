/// <reference types="jest" />

type HostPath = typeof import('../../utils/host-path');

/** Loads a fresh copy of the module, as a new window would, with the storage key as given. */
function loadHostPath(flag?: string): HostPath {
  if (flag === undefined) localStorage.removeItem('interlinearizer.hostPath');
  else localStorage.setItem('interlinearizer.hostPath', flag);
  let loaded: HostPath | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<HostPath>('../../utils/host-path');
  });
  if (!loaded) throw new Error('host-path did not load');
  return loaded;
}

afterEach(() => {
  localStorage.clear();
});

describe('hostPathEnabled', () => {
  it("is on when the storage key is 'true'", () => {
    expect(loadHostPath('true').hostPathEnabled()).toBe(true);
  });

  it('is off when the storage key is absent', () => {
    expect(loadHostPath().hostPathEnabled()).toBe(false);
  });

  it("is off when the storage key holds anything but 'true'", () => {
    expect(loadHostPath('1').hostPathEnabled()).toBe(false);
  });

  it('keeps the answer it first gave when the key changes later in the window', () => {
    const { hostPathEnabled } = loadHostPath('true');
    hostPathEnabled();

    localStorage.removeItem('interlinearizer.hostPath');

    expect(hostPathEnabled()).toBe(true);
  });

  it('is off when the frame is denied storage', () => {
    const { hostPathEnabled } = loadHostPath();
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(hostPathEnabled()).toBe(false);
  });
});
