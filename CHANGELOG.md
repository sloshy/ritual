# Changelog

Notable changes a Ritual user would notice. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release's section here
is also its notes on the [releases page](https://github.com/sloshy/ritual/releases).

**Your data carries forward.** Your decks, collections, wanted lists, their changelogs and
your `ritual.config.json` keep working across upgrades. When a release changes a file
format or a generated file, it ships the change as a `ritual migrate` migration, and Ritual
tells you when one is pending. A release that needs anything more from you says so under
its own heading.

## [Unreleased]

### Added

- Every release binary is published with a build provenance attestation. Check a download
  with `gh attestation verify <file> --repo sloshy/ritual`.

### Changed

- The GitHub Actions deploy workflow that `ritual init-site` generates checks the Ritual
  binary it downloads against the release's published SHA-256 checksum. `ritual migrate`
  brings an existing workflow up to date.
- The Docker image is tagged with each release's version, and `latest` now moves only for a
  stable release, never for a prerelease. A published image reports its release version
  and can pin a workspace's Ritual release like a release binary.
- The Docker image creates `/app/wanted` and exposes the default ports of `admin` (8080)
  and `cache server` (4000) as well as `serve` (3000).
