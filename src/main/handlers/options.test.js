describe('options handler', () => {
  it('exports register function', () => {
    const mod = require('./options');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
