export const meta = {
  name: 'audit-run',
  description:
    'Audit an area for one class of defect: one read-only auditor per track, a second auditor to refute every finding, and one writer for the findings file.',
}

// The input is the Workflow tool's `args`: the audit skill sets every field. The defaults let a
// person run the workflow by hand, without the skill.
const target =
  args && typeof args.target === 'string' && args.target !== '' ? args.target : 'this repository'
const question =
  args && typeof args.question === 'string' && args.question !== ''
    ? args.question
    : 'every defect a senior review would block on'
const tracks =
  args && Array.isArray(args.tracks) && args.tracks.length > 0 ? args.tracks : ['the whole target']
const maxFindings =
  args && Number.isInteger(args.budget) && args.budget > 0 ? args.budget : 12
const findingsPath = args && typeof args.findingsPath === 'string' ? args.findingsPath : ''

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

// One auditor per track, in parallel. Each track is the caller's: the audit skill takes them
// from the review skill's edge-case axes, so the list of tracks has one home (`references/axes.md`).
const audits = await pipeline(tracks, (track) =>
  agent(
    `Audit ${target} for ${question}.\n\nYour track: ${track}. Other auditors take the other tracks; stay on yours.\n\nThe project's own rules, skills and docs are the spec: read the ones your area touches before you judge the code. Prove every finding in the code: the concrete trigger, the real path as file:line, the real outcome, and the missing guard. Try to refute it first; what you cannot prove goes in \`hunches\`, never in \`findings\`. Say in \`coverage\` what you read and what you did not reach.`,
    { label: `audit: ${track}`, model: 'sonnet', effort: 'max', agentType: 'auditor', schema: FINDINGS },
  ),
)

const findings = audits
  .filter((report) => report && Array.isArray(report.findings))
  .flatMap((report) => report.findings)
// The caller's budget bounds the expensive half: the agents this run starts, and the findings
// one report can carry.
const checked = findings.slice(0, maxFindings)

phase('Verify')
log(`${findings.length} finding(s) reported; ${checked.length} checked against the code.`)

// A second, independent auditor tries to refute each finding. Only what survives the code is
// reported: the evidence bar is the review's (`plugin/instructions/core.md` § Review).
const verdicts = await pipeline(checked, (finding) =>
  agent(
    `Try to refute this audit finding in the code. Read the file and line it names, then the code path around it, then look for the guard that would already stop it. Answer \`confirmed\` only when the trigger, the path, the outcome and the missing guard all hold in the code; \`refuted\` when a guard or a constraint already stops it; \`unproven\` when the code does not settle it. Put the lines you read in \`evidence\`.\n\n${JSON.stringify(finding, null, 2)}`,
    { label: 'verify', model: 'opus', effort: 'xhigh', agentType: 'auditor', schema: VERDICT },
  ),
)

const confirmed = checked
  .map((finding, index) => ({ finding, verdict: verdicts[index] }))
  .filter((one) => one.verdict && one.verdict.verdict === 'confirmed')

// What the auditors could not prove, and how far each got: reported apart, never as findings.
const hunches = audits.flatMap((report) =>
  report && Array.isArray(report.hunches) ? report.hunches : [],
)
const coverage = audits
  .map((report, index) =>
    report && typeof report.coverage === 'string' && report.coverage !== ''
      ? `track ${index + 1}: ${report.coverage}`
      : null,
  )
  .filter((one) => one !== null)

phase('Report')
// One writer, on the cheap tier: the judgment is already made, and writing it down is not a
// design decision. The path is a plain string: a template inside a template hides the options
// from the guard, which reads the call's own literals.
const where =
  findingsPath === ''
    ? 'Return the whole report as your answer.'
    : 'Write the report to `' +
      findingsPath +
      '` (create the folder, change no other file), then return the same text as your answer.'
const report = await agent(
  `Write the audit report for ${target}, audited for: ${question}.\n\nOne section per confirmed finding, most severe first: the title, \`file:line\`, the trigger, the outcome, the missing guard, and the fix. Then one coverage line per track: what was audited and what was not reached. Then the hunches, under their own heading, marked as unproven. Report nothing that the code does not support.\n\n${where}\n\nConfirmed findings:\n${JSON.stringify(confirmed, null, 2)}\n\nHunches:\n${JSON.stringify(hunches, null, 2)}\n\nCoverage:\n${coverage.join('\n')}`,
  { label: 'report', model: 'sonnet', effort: 'max', agentType: 'builder' },
)

return report
