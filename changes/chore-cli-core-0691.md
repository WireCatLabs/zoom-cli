### Changed — may break callers

- **`meetings people` puts its next step at the top of the answer.** `next` (the `page.next` step with the cursor),
  `missing` and `meta` were inside `item`, where an agent that reads the answer's own `next` did not find them. The
  shared meetings commands now answer through cli-core's `meetingAnswerBody`.
- **Built on cli-core 0.691.0** (was 0.687.0); cli-base stays 0.109.0. The store moves to schema 69: other WireCat
  CLIs that use it need a version that speaks it. See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
