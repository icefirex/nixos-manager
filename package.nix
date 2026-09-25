{ lib
, stdenv
, buildNpmPackage
, electron

, makeDesktopItem
, copyDesktopItems
, librsvg
}:

let
  pname = "nixos-manager";
  version = "1.9.1";

  desktopItem = makeDesktopItem {
    name = pname;
    desktopName = "NixOS Manager";
    comment = "Graphical NixOS configuration manager";
    exec = pname;
    icon = pname;
    categories = [ "System" "Settings" ];
    terminal = false;
    startupWMClass = "nixos-manager";
  };

in buildNpmPackage {
  inherit pname version;

  src = ./.;

  npmDepsHash = "sha256-BIy6txKpaC0HuN7PVlgz5Sbia8HPrzG7P21ceAgIKek=";

  nativeBuildInputs = [
    copyDesktopItems
    librsvg  # For converting SVG to PNG icons
  ];

  # Skip npm install scripts (electron tries to download binaries)
  # We use system Electron instead
  npmFlags = [ "--ignore-scripts" ];
  dontNpmBuild = false;

  # Build the main process (TypeScript -> dist-electron) and the Svelte frontend
  buildPhase = ''
    runHook preBuild

    # Run unit tests (exclude handler stubs that require electron binary)
    node ./node_modules/.bin/vitest run --exclude 'src/main/handlers/**'

    npm run build:main
    npm run build:svelte
    runHook postBuild
  '';

  # Install the app
  installPhase = ''
    runHook preInstall

    # Create directories
    mkdir -p $out/lib/${pname}
    mkdir -p $out/bin
    mkdir -p $out/share/icons/hicolor/scalable/apps
    mkdir -p $out/share/icons/hicolor/256x256/apps
    mkdir -p $out/share/icons/hicolor/128x128/apps
    mkdir -p $out/share/icons/hicolor/64x64/apps
    mkdir -p $out/share/icons/hicolor/48x48/apps
    mkdir -p $out/share/icons/hicolor/32x32/apps

    # Copy built files
    cp -r dist $out/lib/${pname}/
    cp -r dist-electron $out/lib/${pname}/
    # NOTE: do not place a package.json inside dist-electron/ — the app resolves
    # its root by walking up to the package.json that owns dist/index.html.
    cp package.json $out/lib/${pname}/

    # Install bundled fallback scripts (used when nixos-rebuild-wrapper / nix-eval-flake
    # are not present on the system)
    install -m 755 scripts/nixos-manager-rebuild $out/bin/nixos-manager-rebuild
    install -m 755 scripts/nixos-manager-eval    $out/bin/nixos-manager-eval

    # Install icons
    cp assets/icon.svg $out/share/icons/hicolor/scalable/apps/${pname}.svg
    for size in 256 128 64 48 32; do
      rsvg-convert -w $size -h $size assets/icon.svg -o $out/share/icons/hicolor/''${size}x''${size}/apps/${pname}.png
    done

    # Wrapper: launches system Electron (keeps the nixpkgs launcher's runtime
    # environment setup for GIO/XDG/sandbox paths).
    mkdir -p $out/bin
    cat > $out/bin/${pname} <<WRAP
#!${stdenv.shell}
export ELECTRON_IS_DEV=0
exec ${electron}/bin/electron \
  $out/lib/${pname}/dist-electron/main.js \
  --disable-gpu-compositing "\$@"
WRAP
    chmod +x $out/bin/${pname}

    # Electron binaries report a fixed Wayland app_id / X11 WM_CLASS of
    # "electron" (derived from the compiled-in executable path; no flag or
    # API can change it). Ship a desktop entry under that exact name so
    # compositors resolve the taskbar icon and title to NixOS Manager.
    # Installed system-wide via the NixOS module / system profile.
    mkdir -p $out/share/applications
    cat > $out/share/applications/electron.desktop <<EOF
[Desktop Entry]
Type=Application
Name=NixOS Manager
Icon=nixos-manager
Exec=nixos-manager
StartupWMClass=electron
EOF

    runHook postInstall
  '';

  desktopItems = [ desktopItem ];

  meta = with lib; {
    description = "Graphical NixOS configuration manager";
    homepage = "https://github.com/icefirex/nixos-manager";
    license = licenses.mit;
    platforms = platforms.linux;
    mainProgram = pname;
    maintainers = [ ];
  };
}
