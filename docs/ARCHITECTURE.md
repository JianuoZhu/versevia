# Architecture

## Execution boundaries

| Component | Responsibility | Sensitive data |
| --- | --- | --- |
| `bridge.js` (YouTube MAIN world, document_start) | Read current player metadata, list tracks, request discovered caption URLs, observe native timedtext responses | No extension keys/preferences |
| `bootstrap.js` + `content.js` (isolated content world) | Shadow DOM controls, caption parsing, sentence timeline, display, navigation, playback monitoring and lifecycle | Public preferences and caption/translated text; no provider keys |
| `background.js` (module service worker) | Validate senders, restrict local storage, load provider config, translate, cache, reserve and coordinate capture | Configured keys; does not share them with content scripts |
| `offscreen.js` | Consume tab stream, restore audio output, record bounded WebM, upload with timestamp request, release resources | Speech key and audio temporarily in memory |
| `options.js` / `popup.js` (extension pages) | Endpoint permissions/configuration; normal reading preferences; explicit recording consent | Configured keys only in options |
| `core.js` | Pure parsing/normalization, reconstruction, timing, typing guard and endpoint validation | None persisted |
| `semantic.js` | Immutable source indexing, overlap ownership, boundary validation, sentence/display timelines | Source text and timings in memory |
| `semantic-provider.js` | Structured sentence boundaries and bilingual clause alignment with one bounded structural repair | Selected provider config stays in worker |
| `cache.js` | Extension-origin IndexedDB, TTL and bounded record pruning | Translation text; cache keys are hashes with no API key input |

There is no application framework. The build bundles the SABR protocol bridge locally, then copies `extension/`; test libraries and mock/lab assets are excluded. Modern Chromium provides modules, Shadow DOM, fetch, Intl/navigator language support, IndexedDB, MediaRecorder, Web Audio, AbortSignal and extension APIs.

## Caption and translation pipeline

1. Watch-route change resets pending bridge responses, caption selection, timeline, generated clips and translation state. Player-ID checks reject late data for a prior video.
2. Discovery selects tracks by user source kind and source language; defaults prefer creator captions in the exposed default language. Selecting a generated source never invokes capture.
3. Bridge requests are restricted to a discovered track from the current video and the exact YouTube timedtext origin/path. Observed native text/JSON responses provide a fallback when direct requests lack player authorization. After a direct failure, the content script temporarily enables the real CC button and requests selection of the discovered track through the player. Its prior CC on/off state is restored after success, timeout, disabling or navigation, unless the user has manually clicked CC. Native responses arriving during an in-flight direct request are retried from the observer cache. The bridge protocol is not a security boundary against YouTube's own scripts; no privileged configuration or arbitrary extension fetch operation is exposed through it.
4. JSON3 word offsets are retained when available. Legacy XML `<text start dur>` and timedtext XML `<p t d>` are parsed with DOMParser in the content world. No caption HTML is executed.
5. Deduplicated source text is indexed into immutable word/punctuation units with source offsets. AI semantic mode sends overlapping ~60-second windows with ~15 seconds of lookahead (1,600 units / 16,000 characters maximum). Only ordered index boundaries return from the model; the client reconstructs exact source text and rejects invalid ranges. Unfinished window tails are deferred, with one bounded context expansion when necessary. Rule reconstruction remains the labelled pending/error fallback and the non-AI route.
6. A binary search selects the active sentence from `video.currentTime` on a 100 ms tick. Semantic navigation uses complete sentences; display can use natural clauses within one sentence. Full-sentence translation precedes on-demand bilingual clause alignment, which permits merging dependent clauses. Both languages inherit source-range timing; within-cue boundaries are interpolated when finer timing is absent. No audio alignment is performed. Width/font estimates choose clause combinations but never invent semantic boundaries. Navigation never calls play/pause.
7. Semantic batches start with eight confirmed sentences and grow to 48 / 24,000 characters; rule-mode AI starts with two. Context includes up to eight neighbours per side (4,000 characters each) and eight accepted translation pairs (4,000 combined characters). Conventional providers retain single-sentence requests and two-sentence lookahead. Worker jobs separate segmentation from translation/alignment cancellation so a target-language change retains source boundaries. Generation identities discard late results. Appended ASR revisits the last 15 seconds of previous source; playback-local work is prioritized unless full coverage is selected.
8. Provider failures stop the affected task until retry/configuration change. Invalid semantic/alignment structure gets one repair attempt, but HTTP and translation failures do not retry automatically. While segmentation or alignment is pending/failed, original captions remain visible. AI timeouts are 90 seconds. Versioned caches include full model-visible context and reference translations; task namespaces separate boundary, translation and alignment results. A valid structure does not establish semantic correctness.

## Provider extension point

In 1.5.2, timeline replacement maps sentence identity (text, times, semantic flag and relative clause offsets) to current positional IDs. Unchanged pending inputs retain their generation and completion callbacks map request IDs back through that identity. Changed inputs cancel the generation. Seek cancellation applies in full-coverage mode too; current provisional captions block translation backfill until local segmentation is ready. Full semantic backfill of past gaps always begins at the gap start.

An adapter in `providers.js` implements:

```js
async function translate(input, config, signal, fetchImpl) {
  // input: { text, source, target, before, after }
  // config: { endpoint, model, key }
  // Return a nonempty translated string, or throw ProviderError.
}
```

Register a new adapter in `adapters`, add its ID/default configuration in `config.js`, update preference allowlists and selectors in content/options, and add a request/response contract test. Keep secrets in background/offscreen contexts. Use `fetchProvider` for timeout-compatible, credential-omitting, redirect-rejecting requests and normalized error handling. Distinguish provider-specific language normalization, authentication and payload contracts in the adapter. Update cache version if translation prompt semantics change.

The AI adapter sends one JSON user message containing previous/current/next text with a system instruction to treat it as untrusted subtitle data. This reduces instruction confusion but is not a guarantee against all model prompt injection. Model output is plain text only, never an executable action.

## Video audio generation (1.4.1)

`popup → worker → page audio discovery → offscreen → direct download OR page SABR chunks → browser decode → timestamped ASR → generated cues`.

`src/sabr-page.js` is bundled with the MIT googlevideo protocol definitions into `extension/sabr-page.js`, loaded in MAIN at document_start before `bridge.js`. It observes fetch and XHR POST bodies without consuming the player's stream. A bounded recent SABR template remains in page memory and is discarded on navigation. Only explicit toolbar tasks request audio; passive observation never invokes ASR.

SABR requests preserve the native ustreamer config and streamer context, replace the requested playhead/track selection, and declare video fully buffered to request audio only. Signed addresses and player tokens stay in the page. Redirects are restricted to HTTPS googlevideo.com/videoplayback. UMP parsing verifies format identity, video ID, complete segments and contiguous timestamps, processes server cookies/context updates, and bounds response bytes/retries/timeouts. WebM init+media bytes cross the isolated bridge as bounded base64, then decode in the offscreen document. A duration check rejects unsupported container decoding rather than shifting subtitle timestamps. No remote code execution or native messaging is used.

`audio-job.js` probes SABR metadata before cache access and requests SABR chunks (32 seconds, 8 MB, 60 seconds per interval). The standalone URL route (15 minutes / 20 MB) is used only without usable SABR metadata and with a single language in the exposed audio formats. A five-second diagnostic follows the same SABR and decode path without a provider configuration, upload or cache write. ASR receives 16 kHz mono WAV for SABR; keys remain in trusted extension contexts. Browser audio is held only in memory.

Processing is bounded to the selected five-minute window or entire video (four-hour maximum). Completed intervals are cached in extension IndexedDB with translation cache TTL/pruning/clear. Current-position scheduling reprioritizes only unfinished intervals inside the approved scope. Job IDs reject stale results; navigation and cancellation abort page SABR fetches and offscreen work. Pause/speed/seek do not cancel file-audio tasks. The legacy native sources remain in the repository but are unreachable from this release.

SABR is undocumented and experimental. Requests sent inside a Worker, unsupported codecs, expired authorization or protocol changes can fail. Complete cache hits require a page metadata probe but no audio download or ASR. Cache version v2 includes the actual audio track identity and ignores v1 entries. SABR selection honors clientAbrState.audioTrackId instead of trusting candidate order. Track-change observations clear generated page cues and cancel the prior task; late results from a different track are rejected. Known audio language resolves auto to an explicit ASR language. Provider language mismatches and predominantly Cyrillic responses for English are rejected before display/cache. The Cyrillic check is a limited heuristic, not comprehensive language detection.

## Manual recording fallback lifecycle

`idle → starting → recording → transcribing → ready/error → idle`

Only a trusted toolbar popup message with explicit consent can start capture. The worker validates the active YouTube tab, enabled preference, playing state, 1× rate, finite duration and absence of a detected ad. A session-storage reservation plus a local startup guard prevents overlapping captures and survives normal worker suspension. Lost offscreen contexts clear stale reservations on status inspection.

The offscreen document requests **tab audio only** from the worker's stream ID; it never requests microphone audio. A Web Audio path reconnects the captured stream to the audio destination. A recorder produces a standalone WebM/Opus blob, avoiding the invalid-media problem of treating arbitrary timeslices as independently decodable files. A hard timer limits duration. A 500 ms playback check plus content media events detect drift, buffering, ads, pause, seek and speed changes. Recording is cancelled rather than mapping inconsistent media time.

On finish, tracks and the AudioContext are released before uploading. Multipart transcription requests ask for `verbose_json` and segment timestamps. Segment offsets are validated/clipped to the captured interval and added to the video-time origin. No artificial timings are fabricated from a text-only provider response. Uploaded audio, key references and recording chunks are released after completion or cancellation. An already accepted provider request may still incur charges after client cancellation.

Only active recording/transcription metadata is stored in `storage.session`. Audio is not passed through Chrome's JSON message serialization and never written to disk by the extension. Subsequent same-language clips are merged in page memory, replacing overlaps.

## Current scope and technical tradeoffs

- Direct standalone audio and experimental in-extension SABR extraction are supported. Manual capture remains available separately.
- No offscreen DOM scraping. Caption extraction is deliberately limited to the user's active page data and native caption traffic.
- Main-world hooks remain installed until page unload when the feature is disabled, but only observe bounded YouTube caption data and a recent SABR request template; disabling restores visible captions/keys and stops provider/capture activity. Removing the extension should be followed by reloading existing tabs.
- Semantic recovery uses the selected AI provider when enabled; grammatical accuracy remains model-dependent. Rule-based temporary/non-AI segments use reading limits and do not claim semantic completeness. Word-level source timing is used when supplied; other splits are interpolated. Original-only mode still invokes semantic processing if enabled, but never translation.
- Locale choices include common languages; custom language codes can be entered in the options page. Provider language support remains provider-specific.
- Standard player fullscreen is supported structurally by keeping controls and overlay inside `#movie_player`. Picture-in-Picture, mobile layouts, miniplayer, live streams, Shorts and incognito are not validated or supported targets.
- Translation settings are profile-wide; video position, speed, chosen track and generated clips are per-page/per-video. No playback-speed override is persisted.

## Player entry point (1.0.2)

A `ytp-button` is mounted in `.ytp-right-controls`; settings and subtitles remain in a shadow root inside the player. Click, pointer and keyboard events from extension controls stop before reaching native player bubble handlers. The 100 ms lifecycle tick repairs a replaced control bar without duplicating buttons. The floating button is used only when a control bar is absent.

## Appearance and preset providers (1.1.0)

`catalog.js` is a public list of engine IDs and labels shared by content, options and worker code. Presets keep separate configuration and cache identity even when they share the Chat Completions adapter. No credential is shipped in this catalog. Microsoft Text v3 has a dedicated adapter and regional-key support. Saving a translation provider in options explicitly enables bilingual translation for that engine; speech remains opt-in.

`appearance.js` owns the vector icon, theme styles and direct subtitle manipulation. Pointer capture keeps drag/resize stable outside the handle; movement previews in memory and commits to sanitized preferences on pointer-up. Wheel updates are debounced. Layout uses player-relative percentages rather than viewport pixels, including fullscreen. The overlay remains pointer-transparent outside explicit adjustment mode.
