{
  description = "NixOS Manager — a desktop GUI for managing NixOS flake configurations";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # Supported platforms. aarch64-linux builds are untested but structurally supported.
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      nixpkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      packages = forAllSystems (system: rec {
        nixos-manager = (nixpkgsFor system).callPackage ./package.nix { };
        default = nixos-manager;
      });

      # Run directly: `nix run github:icefirex/nixos-manager`
      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/nixos-manager";
        };
      });

      # NixOS module — add to your configuration to install the app system-wide.
      #
      # In your flake.nix:
      #   inputs.nixos-manager.url = "github:icefirex/nixos-manager";
      #
      # In your NixOS configuration:
      #   imports = [ inputs.nixos-manager.nixosModules.default ];
      #   programs.nixos-manager.enable = true;
      nixosModules = {
        nixos-manager = import ./nixos-module.nix;
        default = self.nixosModules.nixos-manager;
      };
    };
}
