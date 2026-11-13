### Fixed

- **Sync runs on a fresh install.** A shared WireCat config (`~/.config/WireCat/config.json`) that could not be
  read (a byte-order mark, broken JSON, a folder in its place, an older `setup` shape) made every WireCat tool
  read-only and refused `sync`. Now only the owner's own "read only" answer limits a tool, and even then a sync runs:
  it only reads the service into the local store (cli-core 0.656.0).

### Changed — may break callers

- **Built on cli-core 0.656.0** (was 0.651.0). See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
