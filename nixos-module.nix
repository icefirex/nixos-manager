# NixOS module for nixos-manager.
#
# Installs the nixos-manager GUI and ensures polkit is enabled (required for
# privilege-escalated operations such as switching generations and specializations).
#
# When used as a flake input you can override the package:
#
#   programs.nixos-manager = {
#     enable = true;
#     package = inputs.nixos-manager.packages.${pkgs.system}.default;
#   };
{ lib, pkgs, config, ... }:

let
  cfg = config.programs.nixos-manager;
in
{
  options.programs.nixos-manager = {
    enable = lib.mkEnableOption "NixOS Manager GUI application";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ./package.nix { }";
      description = ''
        The nixos-manager package to install.

        When consuming this as a flake input, set this to
        `inputs.nixos-manager.packages.''${pkgs.system}.default`
        so the pre-built package is used instead of rebuilding from source.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    # pkexec (provided by polkit) is required for privilege-escalated operations:
    # generation switching, specialization switching.
    security.polkit.enable = true;
  };
}
