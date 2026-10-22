import { openStore } from "@wirecat/cli-core/store"
import { expect, it } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { preparationFixture } from "../scripts/testing/preparation.js"
import { run } from "./program.js"

it("prepares an explicitly selected project's cited aliases without confirming membership", async () => {
  const f = await preparationFixture(undefined, false, true)
  expect(await run(["meetings", "prepare", "123", "--project", "HAR", "--json"], f.deps)).toBe(0)
  const item = readAnswer(f.output.join(""))
  expect(item.project_evidence).toMatchObject({
    project: "HAR",
    coverage: { page_limit: 4, has_more: false, output_limited: false },
    continuation: null,
  })
  expect(item.project_evidence.pages.map((page: { term: { name: string } }) => page.term.name)).toEqual([
    "Harbour Example",
    "HAR",
    "Bureau Example",
    "ПРИ",
  ])
  expect(item.project_evidence.pages[0].hits).toEqual([])
  for (const page of item.project_evidence.pages.slice(1)) {
    expect(page.association).toBe("unconfirmed-word-evidence")
    expect(page.hits).toHaveLength(1)
    expect(page.hits[0]).toMatchObject({
      meeting: f.candidateReference,
      ref: expect.stringContaining(`${f.candidateReference}/`),
      source: { title: "ПРИ" },
      scope: "transcript",
      offset_ms: 0,
    })
  }
  expect(f.closed).toHaveBeenCalledOnce()
  const store = await openStore({ path: f.path })
  try {
    expect((await store.knowledge.meetingProjects(f.key, { projectId: f.project.id })).items).toHaveLength(2)
  } finally {
    await store.close()
  }
})

it("keeps preparation unchanged without project selection and refuses an invalid project before opening credentials or a store", async () => {
  const f = await preparationFixture()
  expect(await run(["meetings", "prepare", "123", "--project", " ", "--json"], f.deps)).not.toBe(0)
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
  expect(await run(["meetings", "prepare", "123", "--json"], f.deps)).toBe(0)
  expect(readAnswer(f.output.join(""))).not.toHaveProperty("project_evidence")
})
