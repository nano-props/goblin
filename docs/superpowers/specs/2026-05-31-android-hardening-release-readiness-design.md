# Android Hardening And Release Readiness Design

## Goal

Phase 5 turns the v1 Android emergency workflow into a release-ready build candidate by adding focused coverage, recording security/lifecycle review results, and documenting the supported v1 scope.

## Scope

In scope:

- Focused automated tests for target normalization, diagnostics mapping, Git parsing, persisted-state boundaries, terminal lifecycle, worktree safety, and port forwarding lifecycle.
- Security review of password, passphrase, private key, trusted host key, host profile, repository, terminal, and tunnel storage paths.
- Android lifecycle review for terminal/tunnel runtime ownership and known foreground/background limitations.
- Manual UAT checklist for a phone-sized Android device or emulator.
- Release notes covering install/build, credential expectations, supported workflow, and known limitations.

Out of scope:

- Adding new user-facing Git write actions.
- Implementing full Android foreground service notification support.
- Implementing Android-local shell/Git parity.
- Publishing to an app store or signing a production release artifact.

## Release Standard

The v1 build is release-ready when:

- `./gradlew test :app:assembleDebug --rerun-tasks` passes.
- `git diff --check` passes.
- The test coverage matrix maps each Phase 5 success criterion to concrete test files.
- Security review does not identify unexpected storage of SSH passwords, passphrases, or raw private keys in host/repository records.
- Manual UAT steps are documented with explicit pass/fail fields for a phone-sized device.
- Release documentation clearly states SSH private-key initialization, one-time server password use, remote repository/worktree scope, port forwarding scope, and deferred items.

