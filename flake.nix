# Nix package for the light edition of mock-service-cli.
#
# The package version is read from package.json at evaluation time, so a plain commit/push is
# enough to publish a new release to `nix run github:chandq/mock-service-cli` — no per-release
# flake update is needed. The only time this file changes is when the dependency set changes:
# then update `npmDepsHash` (see below).
{
  description = "mock-service-cli - Local Mock/Static/SPA server, HTTP request proxy, API overview page and File explorer";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
      pkgVersion = (builtins.fromJSON (builtins.readFile ./package.json)).version;

      packageFor = system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        pkgs.buildNpmPackage {
          pname = "mock-service-cli";
          version = pkgVersion;
          src = self;

          # npmDepsHash is the fixed-output hash of `npm ci` over package-lock.json. To update it
          # after a dependency change, set this to `lib.fakeHash`, run `nix build`, and paste the
          # hash Nix reports back here.
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

          nativeBuildInputs = [ pkgs.makeWrapper ];
          buildInputs = [ pkgs.nodejs ];

          buildPhase = ''
            runHook preBuild
            npm run build:light
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/node_modules/mock-service-cli
            cp -r package.json bin dist docs $out/lib/node_modules/mock-service-cli/
            cp -r node_modules $out/lib/node_modules/mock-service-cli/
            cd $out/lib/node_modules/mock-service-cli
            npm prune --omit=dev
            mkdir -p $out/bin
            makeWrapper ${pkgs.nodejs}/bin/node $out/bin/mock-service-cli \
              --add-flags "$out/lib/node_modules/mock-service-cli/bin/mock-service-cli"
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Local Mock/Static/SPA server, HTTP request proxy, API overview page and File explorer";
            homepage = "https://github.com/chandq/mock-service-cli";
            license = licenses.mit;
            mainProgram = "mock-service-cli";
          };
        };
    in
    {
      packages = forAllSystems (system: {
        default = packageFor system;
      });
    };
}
