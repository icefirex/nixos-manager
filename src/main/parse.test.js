const {
  extractPackages,
  extractBareNames,
  parseSystemPackages,
  parseHomePackages,
  parseUserPackages,
  parseOptions,
} = require('./parse');

describe('extractPackages', () => {
  it('extracts pkgs.xxx patterns', () => {
    const result = extractPackages('pkgs.htop pkgs.git pkgs.vim');
    expect(result).toEqual(['htop', 'git', 'vim']);
  });

  it('extracts pkgs-stable.xxx patterns', () => {
    const result = extractPackages('pkgs-stable.firefox pkgs-stable.nodejs');
    expect(result).toEqual(['firefox', 'nodejs']);
  });

  it('extracts pkgs-<custom>.xxx patterns', () => {
    const result = extractPackages('pkgs-unstable.hello pkgs-custom.neovim');
    expect(result).toEqual(['hello', 'neovim']);
  });

  it('deduplicates repeated package names', () => {
    const result = extractPackages('pkgs.htop pkgs.htop pkgs.htop');
    expect(result).toEqual(['htop']);
  });

  it('handles empty input', () => {
    expect(extractPackages('')).toEqual([]);
    expect(extractPackages('no packages here')).toEqual([]);
  });

  it('handles names with underscores and hyphens', () => {
    const result = extractPackages('pkgs.nodejs_20 pkgs.my-package');
    expect(result).toEqual(['nodejs_20', 'my-package']);
  });

  it('ignores pkgs without a following word character', () => {
    const result = extractPackages('pkgs.  something');
    expect(result).toEqual([]);
  });
});

describe('extractBareNames', () => {
  it('extracts bare names on their own lines', () => {
    const block = '\n  htop\n  git\n  vim\n';
    expect(extractBareNames(block)).toEqual(['htop', 'git', 'vim']);
  });

  it('ignores names containing dots', () => {
    const block = '\n  htop\n  some.thing\n  git\n';
    expect(extractBareNames(block)).toEqual(['htop', 'git']);
  });

  it('handles empty block', () => {
    expect(extractBareNames('')).toEqual([]);
    expect(extractBareNames('   ')).toEqual([]);
  });
});

describe('parseSystemPackages', () => {
  it('parses environment.systemPackages with pkgs.', () => {
    const content = `
      environment.systemPackages = with pkgs; [
        pkgs.htop
        pkgs.git
        pkgs.vim
      ];
    `;
    expect(parseSystemPackages(content)).toEqual(['htop', 'git', 'vim']);
  });

  it('parses environment.systemPackages without with pkgs', () => {
    const content = `
      environment.systemPackages = [
        pkgs.firefox
        pkgs.nodejs
      ];
    `;
    expect(parseSystemPackages(content)).toEqual(['firefox', 'nodejs']);
  });

  it('extracts bare names from with pkgs blocks', () => {
    const content = `
      environment.systemPackages = with pkgs; [
        htop
        git
        pkgs.vim
      ];
    `;
    const result = parseSystemPackages(content);
    expect(result).toContain('htop');
    expect(result).toContain('git');
    expect(result).toContain('vim');
  });

  it('deduplicates bare names already in extracted list', () => {
    const content = `
      environment.systemPackages = with pkgs; [
        pkgs.htop
        htop
      ];
    `;
    expect(parseSystemPackages(content)).toEqual(['htop']);
  });

  it('returns empty array for no match', () => {
    expect(parseSystemPackages('some other content')).toEqual([]);
    expect(parseSystemPackages('')).toEqual([]);
  });
});

describe('parseHomePackages', () => {
  it('parses home.packages with pkgs.', () => {
    const content = `
      home.packages = with pkgs; [
        pkgs.htop
        pkgs.ripgrep
      ];
    `;
    expect(parseHomePackages(content)).toEqual(['htop', 'ripgrep']);
  });

  it('parses home.packages without with pkgs', () => {
    const content = `
      home.packages = [
        pkgs.fd
        pkgs.bat
      ];
    `;
    expect(parseHomePackages(content)).toEqual(['fd', 'bat']);
  });

  it('extracts bare names from with pkgs blocks', () => {
    const content = `
      home.packages = with pkgs; [
        htop
        pkgs.git
      ];
    `;
    expect(parseHomePackages(content)).toEqual(['git', 'htop']);
  });

  it('deduplicates bare names already in extracted list', () => {
    const content = `
      home.packages = with pkgs; [
        pkgs.bat
        bat
      ];
    `;
    expect(parseHomePackages(content)).toEqual(['bat']);
  });

  it('returns empty array for no match', () => {
    expect(parseHomePackages('some other content')).toEqual([]);
  });
});

describe('parseUserPackages', () => {
  it('parses users.users.<name>.packages', () => {
    const content = `
      users.users.alice.packages = with pkgs; [
        pkgs.htop
        pkgs.git
      ];
    `;
    expect(parseUserPackages(content)).toEqual(['htop', 'git']);
  });

  it('parses multiple user package blocks', () => {
    const content = `
      users.users.alice.packages = with pkgs; [
        pkgs.htop
      ];
      users.users.bob.packages = with pkgs; [
        pkgs.vim
        pkgs.emacs
      ];
    `;
    expect(parseUserPackages(content)).toEqual(['htop', 'vim', 'emacs']);
  });

  it('extracts bare names from with pkgs blocks', () => {
    const content = `
      users.users.alice.packages = with pkgs; [
        htop
        pkgs.git
      ];
    `;
    expect(parseUserPackages(content)).toEqual(['git', 'htop']);
  });

  it('deduplicates when bare name matches extracted name', () => {
    const content = `
      users.users.alice.packages = with pkgs; [
        pkgs.htop
        htop
      ];
    `;
    expect(parseUserPackages(content)).toEqual(['htop']);
  });

  it('returns empty array for no match', () => {
    expect(parseUserPackages('some other content')).toEqual([]);
  });
});

describe('parseOptions', () => {
  const testContent = `
      services.sshd.enable = true;
      programs.git.enable = true;
      networking.hostName = "myhost";
      boot.kernelPackages = pkgs.linux_6_6;
    `;

  it('extracts option assignments from content', () => {
    const options = parseOptions(testContent, 'config.nix');
    expect(options).toHaveLength(4);
  });

  it('assigns correct categories', () => {
    const options = parseOptions(testContent, 'config.nix');
    expect(options.find(o => o.path.startsWith('services.'))).toBeTruthy();
    expect(options.find(o => o.path.startsWith('programs.'))).toBeTruthy();
    expect(options.find(o => o.path.startsWith('networking.'))).toBeTruthy();
    expect(options.find(o => o.path.startsWith('boot.'))).toBeTruthy();
  });

  it('tracks file and line numbers', () => {
    const options = parseOptions(testContent, 'config.nix');
    expect(options[0].file).toBe('config.nix');
    expect(options[0].line).toBe(2);
  });

  it('handles empty content', () => {
    expect(parseOptions('', 'test.nix')).toEqual([]);
  });

  it('handles content with no matches', () => {
    expect(parseOptions('some random text', 'test.nix')).toEqual([]);
  });

  it('categorizes hardware options', () => {
    const options = parseOptions('hardware.opengl.enable = true;', 'test.nix');
    expect(options[0].category).toBe('hardware');
  });

  it('categorizes system options', () => {
    const options = parseOptions('system.autoUpgrade.enable = true;', 'test.nix');
    expect(options[0].category).toBe('system');
  });

  it('categorizes virtualisation options as other', () => {
    const options = parseOptions('virtualisation.vmware.enable = true;', 'test.nix');
    expect(options[0].category).toBe('virtualisation');
  });

  it('categorizes home options as home', () => {
    const options = parseOptions('home.username = "alice";', 'test.nix');
    expect(options[0].category).toBe('home');
  });

  it('strips trailing semicolons from values', () => {
    const options = parseOptions('services.foo.enable = true;', 'test.nix');
    expect(options[0].value).toBe('true');
  });

  it('returns null file when not provided', () => {
    const options = parseOptions('services.foo.enable = true;');
    expect(options[0].file).toBeNull();
  });
});
