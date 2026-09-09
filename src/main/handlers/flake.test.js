describe('flake handler', () => {
  it('exports register and getInputUpdateStatus', () => {
    const mod = require('./flake');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.getInputUpdateStatus).toBeInstanceOf(Function);
  });

  it('getInputUpdateStatus returns an object', () => {
    const { getInputUpdateStatus } = require('./flake');
    expect(getInputUpdateStatus()).toEqual({});
  });

  it('relativeTime formats recent and old timestamps', () => {
    const { relativeTime } = require('./flake');
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(relativeTime(now - 10 * 60 * 1000)).toBe('just now');
    expect(relativeTime(now - 3 * 60 * 60 * 1000)).toBe('3h ago');
    expect(relativeTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');

    nowSpy.mockRestore();
  });

});
