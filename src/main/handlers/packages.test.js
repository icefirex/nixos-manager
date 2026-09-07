describe('packages handler', () => {
  it('exports register function', () => {
    const mod = require('./packages');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
