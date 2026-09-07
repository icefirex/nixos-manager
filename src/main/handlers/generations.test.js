describe('generations handler', () => {
  it('exports register function', () => {
    const mod = require('./generations');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
