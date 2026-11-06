{
  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixpkgs-unstable/nixexprs.tar.zst";
  };

  outputs =
    {
      self,
      nixpkgs,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      forAllSystems = lib.genAttrs lib.systems.flakeExposed;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        rec {
          ghadiag = pkgs.stdenvNoCC.mkDerivation {
            pname = "ghadiag";
            version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

            src = lib.fileset.toSource {
              root = ./.;
              fileset = ./dist/cli.js;
            };

            nativeBuildInputs = [ pkgs.makeBinaryWrapper ];

            dontBuild = true;

            installPhase = ''
              runHook preInstall

              mkdir -p $out/bin $out/libexec/ghadiag
              cp dist/cli.js $out/libexec/ghadiag/cli.js
              makeWrapper ${lib.getExe pkgs.nodejs_26} $out/bin/ghadiag \
                --add-flags "$out/libexec/ghadiag/cli.js"

              runHook postInstall
            '';

            meta = {
              description = "A standalone GitHub Actions workflow and action validator powered by official @actions/languageservice";
              homepage = "https://github.com/kachick/ghadiag";
              license = lib.licenses.mit;
              mainProgram = "ghadiag";
            };
          };

          default = ghadiag;
        }
      );

      apps = forAllSystems (system: rec {
        ghadiag = {
          type = "app";
          program = lib.getExe self.packages.${system}.default;
          meta = self.packages.${system}.default.meta;
        };
        default = ghadiag;
      });

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
