describe('specializations handler', () => {
  it('exports register function and validation regex', () => {
    const mod = require('./specializations');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.VALID_SPEC_NAME.test('gaming')).toBe(true);
    expect(mod.VALID_SPEC_NAME.test('../oops')).toBe(false);
  });
});
