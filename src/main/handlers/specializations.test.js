describe('specializations handler', () => {
  it('exports register function', () => {
    const mod = require('./specializations');
    expect(mod.register).toBeInstanceOf(Function);
  });
});
