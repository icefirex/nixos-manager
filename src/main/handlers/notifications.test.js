describe('notifications handler', () => {
  it('exports register function', () => {
    const mod = require('./notifications');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
