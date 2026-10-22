import { readFileSync } from "node:fs"
import { expect, it, vi } from "vitest"
import { readJsonl } from "../scripts/testing/answers.js"
import { fakeConnection } from "../scripts/testing/connection.js"
import { preparationFixture } from "../scripts/testing/preparation.js"
import { createZoomProjectCandidateReader } from "./meeting-project-candidates.js"
import { run } from "./program.js"

it("scans cited aliases offline with native read-only intent and closes before printing", async () => {
  const f = await preparationFixture(undefined, false, true)
  const before = readFileSync(f.path)
  expect(
    await run(
      [
        "--offline",
        "meetings",
        "projects",
        "scan",
        f.candidateReference ?? "",
        "--cues",
        "1",
        "--limit",
        "1",
        "--bytes",
        "4096",
        "--max-read-bytes",
        "65536",
        "--json",
      ],
      {
        ...f.deps,
        data: (text) => {
          expect(f.closed).toHaveBeenCalledOnce()
          f.output.push(text)
        },
      },
    ),
  ).toBe(0)
  const result = JSON.parse(f.output.join(""))
  expect(result.item).toMatchObject({
    source: { ref: f.candidateReference, account_id: String(f.accountId) },
    association: "unconfirmed-literal-evidence",
    items: [{ project: { ref: f.project.ref } }],
    evidence: { coverage: { archive_completeness: "unknown" } },
  })
  expect(result.item.items[0].matches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        term: expect.objectContaining({ name: "ПРИ", kind: "alias" }),
        source: expect.objectContaining({ kind: "metadata-title" }),
      }),
      expect.objectContaining({
        source: expect.objectContaining({ kind: "transcript", fingerprint: expect.any(String) }),
      }),
    ]),
  )
  expect(f.connectStore).toHaveBeenCalledWith(expect.objectContaining({ intent: "preparation" }))
  expect(f.network).not.toHaveBeenCalled()
  expect(readFileSync(f.path).equals(before)).toBe(true)
  const citation = result.item.items[0].matches.find(
    (match: { source: { kind: string } }) => match.source.kind === "transcript",
  )?.source.ref
  expect(citation).toBeTruthy()
  f.output.length = 0
  expect(
    await run(
      ["--offline", "meetings", "projects", "scan", f.candidateReference ?? "", "--cursor", citation, "--jsonl"],
      f.deps,
    ),
  ).toBe(0)
  expect(readJsonl(f.output.join(""))[0]).toMatchObject({ evidence: { coverage: { included: 0, has_more: false } } })
  f.output.length = 0
  expect(
    await run(
      ["--offline", "meetings", "projects", "scan", f.candidateReference ?? "", "--json=items.project.ref"],
      f.deps,
    ),
  ).toBe(0)
  const projected = JSON.parse(f.output.join(""))
  expect(projected.item.coverage.association).toBe("unconfirmed-literal-evidence")
  expect(projected.item.evidence.coverage.archive_completeness).toBe("unknown")
  expect(projected.item.items[0]).toEqual({ project: { ref: f.project.ref } })
  expect(readFileSync(f.path).equals(before)).toBe(true)
})

it("closes the read when the cited meeting belongs to another account", async () => {
  const f = await preparationFixture(undefined, false, true)
  expect(await run(["--offline", "meetings", "projects", "scan", "meeting:999/1", "--json"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(f.closed).toHaveBeenCalledOnce()
})

it("settles an active call before closing and refuses missing capabilities or cancellation", async () => {
  const close = vi.fn(async () => {})
  const connect = vi.fn(async () => fakeConnection({ accountId: 1, close }))
  const read = createZoomProjectCandidateReader(connect)
  const controller = new AbortController()
  controller.abort()
  await expect(read("meeting:1/2", { signal: controller.signal })).rejects.toThrow()
  expect(connect).not.toHaveBeenCalled()
  await expect(read("meeting:1/2")).rejects.toMatchObject({ code: "configuration_error" })
  expect(close).toHaveBeenCalledOnce()
  const fail = vi.fn(async () => {
    throw Error("invented read refusal")
  })
  const active = createZoomProjectCandidateReader(async () =>
    fakeConnection({ accountId: 1, close, meetingProjectCandidates: fail }),
  )
  await expect(active("meeting:1/2")).rejects.toThrow("invented read refusal")
  expect(close).toHaveBeenCalledTimes(2)
})
