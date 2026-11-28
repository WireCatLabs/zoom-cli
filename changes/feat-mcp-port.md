### Added

- **WireCat Desktop can run this tool's MCP server.** The manifest names the server's port, 8752, so Desktop starts
  and stops the server from the tool page, like the other WireCat tools. Before, Desktop had no port for it and offered
  no server. It needs a Desktop that reads the port from the manifest.
- **The manifest says how Desktop signs in and opens a call.** One sign-in method, `Browser`:
  `{profile} session start --json --answer-stdin`. Desktop opens a Zoom meeting it links to with `meetings show` and
  `meetings transcript`, found by the provider name `zoom`. Desktop keeps its own list only as a fallback.
- **Built on cli-base 1.2.0** (was 1.0.0), which writes the port and the sign-in methods into the manifest.
