### Fixed

- **`zm mcp serve --profiles all` starts on a computer with no profile yet** (cli-core 0.707.0, was 0.691.0;
  cli-base 0.124.0, was 0.109.0). It answers the handshake and lists its tools, and each tool call says how to set up
  the first profile. Directories such as Glama start a server in an empty container only to read its tools, and
  marked zm as one that cannot be deployed.
