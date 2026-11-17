### Changed — may break callers

- **The MCP Registry entry asks which profiles to serve.** It started `mcp serve --profiles all`, so a client that
  installed the server from the registry reached every account on the computer without the owner choosing. Now
  `--profiles` is a required argument with the example `personal`: the client asks for one profile, a
  comma-separated list or `all`. Why: a CLI never picks an account for the owner
  ([WC-MCP-9](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/mcp.md#wc-mcp-9--a-server-serves-the-profiles-it-is-told-with-one-connection-for-each)). Watch for: a client set up from the old entry keeps `--profiles all` until it is set up again; a
  server added by hand or with `mcp config` does not change.
