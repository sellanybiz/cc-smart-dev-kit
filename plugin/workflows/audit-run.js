export const meta = {
  name: 'audit-run',
  description:
    'Audit an area for one class of defect: one read-only auditor per track, a second auditor to refute every finding, and one writer for the findings file.',
}

// The input is the Workflow tool's `args`, passed verbatim: one object, which the audit skill
// fills. A string, an unknown key or a wrong type is refused here, before any agent starts: a
// run on silent defaults would audit something else than the caller asked for. No `args` at all
// runs on the defaults, for a person who starts the workflow by hand. `review-split.js` carries
// the same check: a workflow script cannot import another file, so each one holds its own.
const USAGE =
  'Pass one object: { target?: string, question?: string, tracks?: string[], budget?: number, findingsPath?: string }.'
const refuse = (problem) => {
  throw new Error(`audit-run refused its arguments (${problem}). ${USAGE}`)
}
const isText = (value) => typeof value === 'string'
const CHECKS = {
  target: [isText, 'a string'],
  question: [isText, 'a string'],
  tracks: [(value) => Array.isArray(value) && value.every(isText), 'an array of strings'],
  budget: [(value) => Number.isInteger(value) && value > 0, 'a whole number above 0'],
  findingsPath: [isText, 'a string'],
}
if (args !== undefined) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    refuse(args === null ? 'got null' : Array.isArray(args) ? 'got an array' : `got a ${typeof args}`)
  }
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(CHECKS, key)) refuse(`unknown key "${key}"`)
    if (!CHECKS[key][0](args[key])) refuse(`"${key}" must be ${CHECKS[key][1]}`)
  }
}
const given = args === undefined ? {} : args
const target = given.target || 'this repository'
const question = given.question || 'every defect a senior review would block on'
const tracks = given.tracks && given.tracks.length > 0 ? given.tracks : ['the whole target']
const maxFindings = given.budget || 12
const findingsPath = given.findingsPath || ''

// What one auditor returns. Claude Code validates an agent's answer against this shape before
// the script reads it, so a prose answer never reaches the verifier.
const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'trigger', 'outcome', 'missingGuard', 'severity'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          trigger: { type: 'string' },
          outcome: { type: 'string' },
          missingGuard: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'suggestion'] },
        },
      },
    },
    hunches: { type: 'array', items: { type: 'string' } },
    coverage: { type: 'string' },
  },
}

// What one verifier returns: the finding kept only when it survives.
const VERDICT = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unproven'] },
    reason: { type: 'string' },
    evidence: { type: 'string' },
  },
}

phase('Audit')
log(
  `Auditing ${target} for ${question} on ${tracks.length} track(s); at most ${maxFindings} finding(s) are verified.`,
)

// One auditor per track, in parallel, on `sonnet` at `high`: the breadth, which `high` covers.
// Each track is the caller's: the audit skill takes them from the review skill's edge-case axes,
// so the list of tracks has one home (`references/axes.md`). The auditor's own file already
// denies the editing tools; each launch denies them too, so no track edits the checkout the
// others read even if that file changes.
const audits = await pipeline(tracks, (track) =>
  agent(
    `Audit ${target} for ${question}.\n\nYour track: ${track}. Other auditors take the other tracks; stay on yours.\n\nThe project's own rules, skills and docs are the spec: read the ones your area touches before you judge the code. Prove every finding in the code: the concrete trigger, the real path as file:line, the real outcome, and the missing guard. Try to refute it first; what you cannot prove goes in \`hunches\`, never in \`findings\`. Say in \`coverage\` what you read and what you did not reach.`,
    {
      label: `audit: ${track}`,
      model: 'sonnet',
      effort: 'high',
      agentType: 'cc-smart-dev-kit:auditor',
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      schema: FINDINGS,
    },
  ),
)

const findings = audits
  .filter((report) => report && Array.isArray(report.findings))
  .flatMap((report) => report.findings)
const SEVERITIES = ['critical', 'warning', 'suggestion']
const rankOf = (severity) => {
  const at = SEVERITIES.indexOf(String(severity).toLowerCase())
  return at === -1 ? SEVERITIES.length : at
}

// The caller's budget bounds the expensive half: the agents this run starts. The cut falls on the
// least severe, never on the last track: the sort is stable, so equal severities keep their track
// order. What the budget does not reach goes to the writer unchecked, never dropped.
const ranked = findings.slice().sort((a, b) => rankOf(a.severity) - rankOf(b.severity))
const checked = ranked.slice(0, maxFindings)
const unchecked = ranked.slice(maxFindings)

phase('Verify')
log(
  `${findings.length} finding(s) reported; ${checked.length} verified against the code, ${unchecked.length} not (reported unchecked).`,
)

// A second, independent auditor tries to refute each finding. Only what survives the code is
// reported: the evidence bar is the review's (`plugin/instructions/core.md` § Review).
const verdicts = await pipeline(checked, (finding) =>
  agent(
    `Try to refute this audit finding in the code. Read the file and line it names, then the code path around it, then look for the guard that would already stop it. Answer \`confirmed\` only when the trigger, the path, the outcome and the missing guard all hold in the code; \`refuted\` when a guard or a constraint already stops it; \`unproven\` when the code does not settle it. Put the lines you read in \`evidence\`.\n\n${JSON.stringify(finding, null, 2)}`,
    {
      label: 'verify',
      model: 'opus',
      effort: 'xhigh',
      agentType: 'cc-smart-dev-kit:auditor',
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      schema: VERDICT,
    },
  ),
)

const judged = checked.map((finding, index) => ({ finding, verdict: verdicts[index] }))
const verdictOf = (one) => (one.verdict ? one.verdict.verdict : undefined)
const confirmed = judged.filter((one) => verdictOf(one) === 'confirmed')
const placeOf = (finding) =>
  finding.line === undefined ? finding.file : finding.file + ':' + finding.line

// A finding the verifier could not settle, or that got no answer, is not proved and not refuted:
// it goes to the writer with the hunches, with the verifier's reason, never counted away.
const unprovenHunches = judged
  .filter((one) => verdictOf(one) !== 'confirmed' && verdictOf(one) !== 'refuted')
  .map((one) => {
    const why =
      one.verdict && typeof one.verdict.reason === 'string' && one.verdict.reason !== ''
        ? one.verdict.reason
        : 'the verifier returned no answer'
    return `[${String(one.finding.severity).toUpperCase()}] ${one.finding.title} — ${placeOf(one.finding)} (unproven: ${why})`
  })

// What the auditors could not prove, and how far each got: reported apart, never as findings.
const hunches = unprovenHunches.concat(
  audits.flatMap((report) => (report && Array.isArray(report.hunches) ? report.hunches : [])),
)
const coverage = audits
  .map((report, index) =>
    report && typeof report.coverage === 'string' && report.coverage !== ''
      ? `track ${index + 1}: ${report.coverage}`
      : null,
  )
  .filter((one) => one !== null)

phase('Report')
// One writer, on `sonnet` at `medium`: the judgment is already made, and writing it down is not
// a design decision. The path is a plain string: a template inside a template hides the options
// from the guard, which reads the call's own literals.
const where =
  findingsPath === ''
    ? 'Return the whole report as your answer.'
    : 'Write the report to `' +
      findingsPath +
      '` (create the folder, change no other file), then return the same text as your answer.'
const uncheckedLines = unchecked.map(
  (finding) => `- [${String(finding.severity).toUpperCase()}] ${finding.title} — ${placeOf(finding)}`,
)
const uncheckedText =
  unchecked.length === 0
    ? 'Unchecked findings: none.'
    : `Unchecked findings (${unchecked.length}, not verified: the budget did not reach them), to copy as they are:\n${uncheckedLines.join('\n')}`
const report = await agent(
  `Write the audit report for ${target}, audited for: ${question}.\n\nOne section per confirmed finding, most severe first: the title, \`file:line\`, the trigger, the outcome, the missing guard, and the fix. Then one coverage line per track: what was audited and what was not reached. Then the unchecked findings, under their own heading, listed as given and marked as not verified: say that the caller can check them or run again. Then the hunches, under their own heading, marked as unproven. Report nothing that the code does not support.\n\n${where}\n\n${uncheckedText}\n\nConfirmed findings:\n${JSON.stringify(confirmed, null, 2)}\n\nHunches:\n${JSON.stringify(hunches, null, 2)}\n\nCoverage:\n${coverage.join('\n')}`,
  { label: 'report', model: 'sonnet', effort: 'medium', agentType: 'cc-smart-dev-kit:builder' },
)

return report
