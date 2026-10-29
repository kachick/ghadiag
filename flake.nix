{
  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixpkgs-unstable/nixexprs.tar.zst";
  };

  outputs =
    {
      nixpkgs,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      forAllSystems = lib.genAttrs lib.systems.flakeExposed;
    in
    {
      formatter = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        pkgs.writeShellScriptBin "dprint-fmt" ''
          exec "${lib.getExe pkgs.dprint}" fmt "$@"
        ''
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShellNoCC {
            # Set NIX_PATH for nixd inlay hints
            env.NIX_PATH = "nixpkgs=${nixpkgs.outPath}";

            buildInputs = (
              with pkgs;
              [
                # For Nix environments
                bashInteractive
                nixd

                nodejs_26
                pnpm_12
                typescript
                oxlint
                dprint
                typos
                zizmor

                gh
                jq
                yq-go
                betterleaks
              ]
            );
          };
        }
      );
    };
}
