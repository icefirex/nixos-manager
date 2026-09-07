describe('system handler', () => {
  it('exports register function', () => {
    const mod = require('./system');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
