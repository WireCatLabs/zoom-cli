### Changed — may break callers

- **Built on cli-core 0.646.0** (was 0.620.0). The store moves to version 66 on first open (people ties, person kinds
  and name order; additive). `doctor reports show` and `doctor reports create` write a problem report to send. What
  changed in between is in [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
- **`schedule pause <name>` and `schedule resume <name>`** take a schedule off its timer and keep it; `schedule run`
  still runs it. `--at` repeats: `--at 08:30 --at 18:00` runs twice a day.
