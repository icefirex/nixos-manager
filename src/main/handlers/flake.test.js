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
});
