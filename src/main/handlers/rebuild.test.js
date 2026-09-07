describe('rebuild handler', () => {
  it('exports register function', () => {
    const mod = require('./rebuild');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
