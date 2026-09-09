describe('discover handler', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('exports register and cleanup functions', () => {
    const mod = require('./discover');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.cleanup).toBeInstanceOf(Function);
  });

  it('detects tty-related errors', () => {
    const mod = require('./discover');
    expect(mod.isTTYError('error opening terminal')).toBe(true);
    expect(mod.isTTYError('all good')).toBe(false);
  });

  it('decodes xml entities in catalog values', () => {
    const mod = require('./discover');
    expect(mod.decodeXmlEntities('Fish &amp; Chips &lt;3')).toBe('Fish & Chips <3');
  });

  it('extracts icon and categories from appstream xml snippet', () => {
    const mod = require('./discover');
    const xml = `
<component type="desktop-application">
  <id>org.demo.App</id>
  <name>Demo</name>
  <pkgname>demo</pkgname>
  <icon type="cached">demo.png</icon>
  <categories>
    <category>Utility</category>
    <category>GTK</category>
  </categories>
</component>
`;

    expect(mod.extractIcon(xml)).toEqual({ type: 'cached', name: 'demo.png' });
    expect(mod.extractCategories(xml)).toEqual(['Utility', 'GTK']);
  });

  it('parses appstream xml component fields', () => {
    const mod = require('./discover');
    const parsed = mod.parseAppStreamXML(`
<components version="0.16">
  <component type="desktop-application">
    <id>org.gimp.GIMP</id>
    <pkgname>gimp</pkgname>
    <name>GIMP</name>
    <summary>Image editor</summary>
    <description><p>Powerful editor</p></description>
    <url type="homepage">https://gimp.org</url>
  </component>
</components>
`);

    expect(parsed.length).toBeGreaterThanOrEqual(1);
    const gimp = parsed.find(p => p.pkgname === 'gimp');
    expect(gimp).toBeTruthy();
    expect(gimp.name).toBe('GIMP');
    expect(gimp.summary).toBe('Image editor');
    expect(gimp.homepage).toBe('https://gimp.org');
  });

});
