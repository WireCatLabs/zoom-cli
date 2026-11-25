### Changed — may break callers

- **zm runs on cli-core 1.0 and cli-base 1.0** (cli-core 1.0.0, was 0.707.0; cli-base 1.0.0-rc.1, was 0.124.0).
  cli-core 1.0 moves the message store to version 73 the first time it opens it: an id is never handed out twice,
  and a JSON column holds valid JSON. After that, only tools on cli-core 1.0 open the store. Watch for: upgrade every
  installed WireCat CLI to its 1.0 release first, and stop `serve`, `mcp` and every sync while the store migrates;
  the migration writes a rollback copy first and refuses to run without one. See
  [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).

### Security

- **An MCP call cannot name a credential folder, a WireCat tool's folder or the message store.** Every option and
  argument that takes a local file or folder (`zm recordings download --output-dir`, `zm meetings import <folder>`,
  the archive folder of `zm recordings archive` and the rest) is checked by its real path before the call runs, so
  neither a link nor `..` gets past. A refused call answers `permission_error` (`access.denied`) with the option in
  `param`. A run in a terminal is unchanged.
