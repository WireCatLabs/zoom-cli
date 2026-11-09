### Changed — may break callers

- **Built on cli-core 0.624.0** (was 0.620.0). The store moves to version 61 on first open (people ties, additive).
  What changed in between is in [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
- **`schedule pause <name>` and `schedule resume <name>`** take a schedule off its timer and keep it; `schedule run`
  still runs it. `--at` repeats: `--at 08:30 --at 18:00` runs twice a day.
