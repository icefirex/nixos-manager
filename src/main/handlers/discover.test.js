describe('discover handler', () => {
  it('exports register and cleanup functions', () => {
    const mod = require('./discover');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.cleanup).toBeInstanceOf(Function);
  });
});
