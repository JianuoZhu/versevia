# Changelog

## 1.5.3 — 2026-09-18

- Fix provider saves mixing endpoint and credentials when the form changes while an origin-permission prompt is pending.
- Validate job IDs on manual recording progress/results so a late response cannot overwrite a newer recording on the same video.
- Recheck cancellation before uploading a finished manual recording.
- Clean obsolete build output; reject stale or mismatched ZIP inputs and inconsistent release versions.
- Add deterministic ZIP packaging, SHA-256 checksums, packaging regressions, and GitHub CI for Windows/Linux with Node 22/24.
- Add a Chinese release README, detailed English user guide, MIT license, and third-party notices.

## 1.5.2 — 2026-09-18

- Preserve pending translation/alignment when semantic timeline updates keep the source sentences unchanged, including positional ID changes.
- Prioritize new seek positions in nearby and whole-video modes while retaining completed results.

## 1.5.1 — 2026-09-18

- Add explicit provider latency diagnostics and deterministic scheduling probes.

## 1.5.0 — 2026-09-17

- Add AI semantic sentence boundaries, contextual translation batches, and bilingual clause alignment.

Earlier implementation and test history is recorded in [Verification](docs/VERIFICATION.md).
