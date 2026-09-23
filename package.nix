{ lib
, stdenv
, buildNpmPackage
, electron
, makeWrapper
, makeDesktopItem
, copyDesktopItems
, librsvg
}:

let
  pname = "nixos-manager";
  version = "1.8.0";

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

  npmDepsHash = "sha256-kiXHinjbwIjmmDCBpOd3ZckE5g5tdSjdyE6PWzbEnFU=";

  nativeBuildInputs = [
    makeWrapper
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

    # Create wrapper script that uses system Electron
    # GPU flags help reduce compositor stutter on launch/close
    makeWrapper ${electron}/bin/electron $out/bin/${pname} \
      --add-flags "$out/lib/${pname}/dist-electron/main.js" \
      --add-flags "--disable-gpu-compositing" \
      --set ELECTRON_IS_DEV 0

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
