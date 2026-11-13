### Changed — may break callers

- **Built on cli-core 0.651.0 and cli-base 0.99.0** (were 0.648.0 and 0.98.0). A stale meeting project fingerprint
  answers `conflict` (reason `meeting-project.stale`), not `configuration_error`. cli-core's reasons `oauth.missing`
  and `ai.address-refused` are now `session.missing` and `model.address-refused`. `contracts/wirecat.json` lists the
  hosts the shared packages reach (npm's registry, Hugging Face and GitHub downloads), so WireCat Desktop shows them.
  What else changed is in [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).

