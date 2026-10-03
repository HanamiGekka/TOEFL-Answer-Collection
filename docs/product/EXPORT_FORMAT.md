# Export Format

TOEFL exports support dynamic Session v6 only, including official v1.0.0 v6 records. Training name remains persisted `package_id`; UI locale does not translate machine fields/user text.

## Session files

- `answers.json`: `practice-session-v6`, sections, confirmed configurations, answer/progress/flags, timing, lifecycle, and Writing history.
- `events.jsonl`: ordered lifecycle/answer events with stable identity and unique sequence numbers.
- `item_metrics.csv`, `section_metrics.csv`: stable item order and integer active/pause/elapsed values.
- `session_summary.md` and selected `Reading.md`, `Listening.md`, `Writing.md`: summaries and recorded answers, including long text.
- `record-index.json`: Training name/date/mode/sections/item counts/time/status, format/profile/application metadata, relative directory, file names, and final size.

Exports contain no external source path, question bodies, real option text, audio, answer keys, automatic checking, grading, or accuracy score. Choice exports contain label selections only. Pre-v6/module/task export formats are unsupported.

The stable directory uses sanitized Training name, creation timestamp, and session identity. Repeated exports target the same identity. Atomic publication prevents partial formal exports. Current v6 Recovery can produce an incomplete export without mutating its original snapshot.

## Typing and auditor

Typing retains independent JSON, Markdown, events/minute trend formats, local text, active/pause time, character metrics, and CPM/WPM ratios. It is not a TOEFL answer grade.

From `app/`, run `npm run audit:session -- <export-directory> [--json-report <report-file>]`. The read-only auditor checks current v6 identity, file set, membership/ordinals/configuration, time closure, index metadata, and monotonic unique event sequence. It writes a report only when requested; audited files never change. Tests derive synthetic exports from the official v1.0.0 fixture and check duplicate-event rejection and byte identity.
