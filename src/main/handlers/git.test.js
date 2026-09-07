describe('git handler', () => {
  it('exports register function', () => {
    const mod = require('./git');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
