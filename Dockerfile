# For directories that start the MCP server only to list its tools (Glama). It signs in to nothing:
# the profile name is made up and the home folder is empty.
FROM node:24-slim
# hadolint ignore=DL3016
RUN npm install -g @wirecat/zoom-cli && npm cache clean --force
USER node
CMD ["zm", "glama", "mcp"]
