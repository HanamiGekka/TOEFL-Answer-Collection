# Timing Profiles

Built-in profiles: `config/timing-profiles/toefl-2026-practice.json` and `toefl-2026-exam-simulation.json`. These values are local practice/simulation settings, not claims of permanently fixed official timings.

## Writing

- Email: 420 seconds.
- Academic Discussion: 600 seconds.
- Build a Sentence: The versioned Blueprint currently defines independent Task slots BS1–BS10. Exact official order remains `NEEDS_USER_CONFIRMATION`.
- Practice marks overtime at the limit, preserves the full text, and permits continued editing.
- Exam simulation preserves the full text at the limit, locks editing, and allows explicit entry into the next Task.
- Email becomes overtime as soon as `active >= 420000ms`; Discussion does so at `active >= 600000ms`. UI, compatible Question, Task, events, and export share these boundaries.

## Speaking

- Listen and Repeat: SR1–SR7 share a local 120-second group limit. Time does not start before Start is selected, and Practice does not advance automatically at the limit.
- Interview: SI1–SI4 each have a 45-second limit and zero preparation time. Time does not start before Start, and at most one Task can be ACTIVE.
- Retry resets the current remaining time and increments attempt count while preserving cumulative active time and old events.
- Complete / Needs Retry are rejected for 750ms after Start/Retry. Duplicate status actions are rejected while asynchronous saving is pending, without blocking global Pause or timeout.

## Listening

Practice permits returning only to encountered questions. Exam simulation forbids backward navigation in the UI, Store, engine, and restore path. A question can be answered immediately upon entry, without an external audio-phase button.

Centralized profile/runtime policy decides all mode differences; components do not scatter these decisions.
