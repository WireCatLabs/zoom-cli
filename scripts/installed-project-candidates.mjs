import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

export const checkProjectCandidates = async ({ load, path, key, connector, reference, project }) => {
  const { readMeetingProjectCandidates, callMeetingProjectCandidatesTool } = await load("@wirecat/cli-core/cli")
  let calls = 0,
    closes = 0
  const read = async (ref, options) => {
    calls++
    const connection = await connector({ profile: "AliceExample", externalId: key.account, intent: "preparation" })
    try {
      return await connection.meetingProjectCandidates(ref, options)
    } finally {
      await connection.close()
      closes++
    }
  }
  const before = readFileSync(path)
  const answer = await readMeetingProjectCandidates(read, { ref: reference })
  assert.equal(calls, closes)
  assert.equal(answer.item.source.ref, reference)
  assert.equal(answer.item.association, "unconfirmed-literal-evidence")
  assert.equal(answer.item.items[0].project.ref, project.ref)
  assert.ok(
    answer.item.items[0].matches.some((match) => match.source.kind === "metadata-title" && match.term.name === "ПРИ"),
  )
  assert.ok(
    answer.item.items[0].matches.some(
      (match) => match.source.kind === "transcript" && match.source.ref.startsWith(`${reference}/`),
    ),
  )
  assert.equal(answer.item.evidence.coverage.archive_completeness, "unknown")
  const invalid = await callMeetingProjectCandidatesTool(read, { ref: reference, account_id: 999 })
  assert.equal(invalid.isError, true)
  assert.match(JSON.stringify(invalid.structuredContent), /account_id/)
  assert.equal(calls, 1)
  const result = await callMeetingProjectCandidatesTool(read, { ref: reference, bytes: 4096 })
  assert.notEqual(result.isError, true)
  assert.equal(calls, closes)
  assert.equal(result.structuredContent.item.source.ref, reference)
  assert.ok(result.structuredContent.meta.run_id)
  assert.ok(Buffer.byteLength(JSON.stringify(result.structuredContent.item)) <= 4096)
  assert.deepEqual(readFileSync(path), before)
  return {
    project_candidates_installed_sdk: true,
    project_candidates_no_writes: true,
    project_candidates_strict_arguments: true,
    project_candidates_close_before_output: true,
  }
}
