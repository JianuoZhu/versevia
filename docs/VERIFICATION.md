# Verification report

## 1.5.3 release review — 2026-09-18

- Reviewed the production caption/semantic pipeline, provider configuration and credential boundaries, audio lifecycle, cache, protocol bridge, build/package scripts, and existing regression coverage.
- Reproduced two regressions before fixing them: editing/switching the provider form during a pending permission prompt mixed the original endpoint with the newly displayed credentials; late manual recording progress/results could alter a newer job on the same video. Form values are now captured together before awaiting permission, and both recording routes validate job IDs.
- Added a cancellation check after transcription-progress reporting so cancellation in that interval prevents a manual audio upload.
- Builds remove stale `dist/` output and require matching package/manifest versions. Packaging rejects missing, modified, extra or linked inputs, emits deterministic ZIP metadata, and writes a SHA-256 checksum. Regression fixtures verify stale output removal and invalid package inputs.
- On Windows with Node 24.14.0 and Python 3.14, `npm.cmd run release` passed: **166 JavaScript tests, 4 Python packaging tests**, syntax checks, build and ZIP generation. ZIP integrity, included licenses, checksum and local Markdown links passed inspection. Pattern-based scans of release/source files found no credential matches; this is not a formal security audit.
- `npm audit --json` reported **0 known vulnerabilities** in the locked npm dependency tree at review time. Historical native-host Python dependencies are outside the current extension release.
- Exported only the staged Git source into an isolated directory, installed with `npm ci`, and reran `npm run release`: all 166 JavaScript tests and 4 packaging tests passed again. The build regenerated the ignored SABR bundle without relying on existing local build files.
- GitHub CI is configured for Windows/Linux with Node 22/24 and Python 3.12; these remote jobs have not yet run. No live paid AI/ASR request or installed-extension YouTube end-to-end test was performed during this review. Existing historical browser evidence below does not establish current compatibility for every video, provider or browser.

## 1.5.2 request preservation and seek priority — 2026-09-18

- Reproduced failing regressions before the fix: an unchanged in-flight batch was aborted by the next semantic window; whole-video mode did not start near a far seek while an old semantic request was pending.
- Semantic timeline updates now match exact source sentences and remap positional IDs, preserving both pending translation and alignment when their input survives. Completed results and error state are remapped as well. Changed inputs still invalidate the generation. Translation replies use their original request IDs for validation and source identity for placement, avoiding wrong-caption results after preceding gaps change length.
- Seeking now aborts unrelated semantic work even in whole-video mode, starts semantic windows near the new playhead, and stops unrelated translation/alignment work while retaining completed results. Translation backfill waits when the current sentence remains provisional. Once current-area semantics are available, full coverage can resume older gaps without jumping into their incomplete tail.
- `npm.cmd run verify` passed: production build (34 files), syntax checks, all 162 tests. Five production content/worker scheduling scenarios cover translation preservation, alignment preservation, a 5-to-135-second seek in nearby/full modes, and successful result mapping after old-gap completion changes sentence IDs. Regression fixtures use gated simulated provider responses and do not claim a new live OpenAI performance measurement.
- Rebuilt `dist` and standalone ZIP as 1.5.2. Reload the extension and YouTube tabs. Provider/model/reasoning settings are unchanged. Cancelling the client request does not guarantee a provider stops processing or billing an already accepted request.

## 1.5.1 latency diagnosis — 2026-09-18

- Ran `node scripts/probe-subtitle-latency.mjs` and its `--long` scenario against production content/worker code with explicitly gated simulated provider responses. Confirmed omitted reasoning parameters in all three tasks, three sequential responses before a cold long sentence displays its translation, and cancellation/reissue of the same eight-sentence translation batch after the next semantic window completes. These probes do not measure real OpenAI latency. The scheduling defect is documented and remains unfixed in this diagnostic release.
- Added an explicit Options comparison using the saved official GPT-5.6 Luna configuration: six synthetic eight-sentence requests comparing default/low/none, with total/header latency, usage, reasoning/cache token counts and translated output. It changes no settings, uses no video captions, has no extension cache, and never returns credentials. Content scripts cannot invoke it. Stop prevents the next request after the current one finishes.
- `npm.cmd run verify` passed: 34-file build, syntax checks, all 157 tests. Added tests verify identical prompts across reasoning variants, full-body timing, safe metadata, endpoint/model restrictions, user-triggered Options sequencing and unchanged preferences. The live comparison is pending extension reload and execution in the user's configured browser.

## 1.5.0 semantic sentences and contextual translation — 2026-09-17

- `npm.cmd run verify` passed: build (33 files), JavaScript syntax checks and all 156 tests. The new tests cover immutable source ranges, manually annotated Japanese boundaries, window tails, incomplete seek prefixes, bounded context expansion, structural repair limits, multilingual timing, alignment merges, sender checks, separate cancellation, target-language reuse, contextual cache identity, 48-sentence batches and content-to-worker integration.
- Actual Chrome ran the production content script in `/watch?v=abcdefghijk&semantic=1`, an explicitly labelled fixture with simulated AI responses and a silent video. The UI confirmed four semantic sentences and matching Chinese translations. At 40 px original text size, the long sentence displayed its first natural Japanese clause on two lines with the corresponding Chinese clause. This verifies browser layout and pipeline behavior, not model output quality. Automated integration additionally verifies that next-sentence navigation skips the internal display break and preserves pause state.
- Existing service/model settings are reused, with semantic mode enabled by default for AI engines. No new dependency, credential, audio upload or forced alignment was added. Within-source-cue timing remains proportional. Long indivisible bilingual groups can exceed the approximate two-line reading target.
- No live GPT-5.6 Luna request or installed-extension playback of the reported video was performed. Human-authored fixtures do not establish real-world semantic or translation accuracy. Reload the extension and refresh YouTube after loading the rebuilt `dist` or extracted standalone ZIP. See [中文方案及限制](SEMANTIC.zh-CN.md).

## Unpunctuated Japanese caption length correction — 2026-09-17

- The reported screenshot contains several thoughts in one overlay. Code inspection confirmed that reconstruction previously allowed 220 characters / 18 seconds and relied primarily on punctuation; the duration check also failed to split an oversized individual cue.
- Reading defaults now use 48 characters for CJK text (including detection when language is unknown), 120 otherwise, a 7-second duration budget and gaps over 0.7 seconds. Oversized units are split before merging, so short source-cue offsets survive unchanged. Within-cue splits still use approximate proportional timing; indivisible words remain intact. This is a readability fallback, not semantic segmentation of unpunctuated speech.
- Three new core regressions failed against the old implementation and pass after the fix. The Japanese fixture uses text transcribed from the screenshot and synthetic timings, not a captured track. A content-script integration regression verifies bounded display and next-chunk navigation.
- `npm.cmd run verify` passed: production build, syntax checks and all 129 tests. Updated `dist/` and the standalone ZIP. Installed-browser playback of the reported video and real provider output were not tested; reload the extension and refresh YouTube to activate the build.

## Same-document video navigation and translation recovery — 2026-09-17

- Replaced translation and speech-cache video checks against the message sender's document URL with checks against the current browser tab URL. Regression fixtures reproduce rejection of new-video translation when the sending document still identifies the previous watch page or Home.
- Translation jobs now carry their video ID. Delayed navigation notifications and same-video query changes preserve current-video work while cancelling previous-video requests. Conventional translation also checks cancellation after asynchronous setup, before sending text, and before returning results.
- `npm.cmd run verify` passed: production build, JavaScript syntax checks, and all 125 tests. Coverage includes click navigation, autoplay player updates, stale sender URLs, explicit Retry after provider failure, cancellation during setup, old-result isolation, and both AI batch and conventional translation paths.
- Updated `dist/` and `sentence-extension.zip`. Reload the extension and then refresh existing YouTube tabs to activate the fix. Real installed-browser navigation and the user's configured translation provider were not exercised in this session; provider responses in the regression suite are simulated.

## 1.4.1 audio language and dubbed-track correction — 2026-09-16

- `npm.cmd run verify` completed successfully: production build, syntax checks and 92 tests. An additional focused content regression test then passed with its existing 14 companion tests (93 total tests across the suite). That test covers track changes clearing generated subtitles, cancellation, rejection of late prior-track results and source-language changes clearing old text.
- Confirmed defects in 1.4.0: SABR selected the first candidate without checking the native active audio track, auto ASR discarded known audio language, and subtitle caches did not distinguish dubbed tracks. Regressions now cover an English active track after a Ukrainian candidate, explicit `language=en` with auto selection, rejection of Russian responses before caching, different English dubs producing separate cache entries, and mid-job track changes stopping before upload.
- Prior browser inspection of the user's reported video `_6fnMOWHpRs` showed English original `en-US.4`, multiple automatic dubs including Ukrainian, and English native automatic captions. The opened page displayed English native subtitles. The failing historical SABR request and Whisper response were not captured, so the precise incident cause (track mismatch, model language error or old cache) remains unproven; the identified code paths are corrected.
- Version 1.4.1 adds language and track identity to the no-ASR diagnostic. Legacy v1 generated caches are bypassed, without deleting translation settings or caches. The rebuilt `dist` and standalone ZIP require extension reload and a YouTube refresh.
- No real paid ASR request was made during this fix. Installed-browser regeneration of this specific failing case is pending; passing synthetic regression tests is not a claim that the historical output was reproduced live.

## 1.4.0 pure-extension SABR experiment — 2026-09-13

- 89 JavaScript tests pass. Coverage includes native request preservation, future interval requests, format/language matching, UMP media assembly, timestamp continuity, wrong-video/protected/truncated/redirect rejection, offscreen duration checks, cache reuse, job cancellation and permission boundaries. Tests use synthetic protocol responses; they do not establish live YouTube authorization compatibility.
- Actual Chrome decoded the synthetic WebM fixture with timestamps starting at 120 seconds and produced a 5-second, 16 kHz mono WAV (160,044 bytes, RMS 0.0883006). This tests the real browser decoder, not YouTube networking or ASR.
- Version 1.4.0 removes nativeMessaging permissions and all helper calls from the shipped extension. No helper was installed or registered for this release. An existing development FFmpeg binary was used only to generate the synthetic decoder fixture; the extension has no FFmpeg dependency.
- A toolbar **Test browser audio · no speech API** action exercises page SABR fetching and offscreen decoding without a speech key, provider call or cache write. Signed requests and player tokens remain in page memory; returned diagnostics contain only timing/signal information or a bounded error.
- The user reported a successful real installed-extension YouTube diagnostic: `SABR audio verified: 5.0 s decoded at 12.8 s · audio signal detected. No speech API called.` This confirms SABR acquisition and browser decoding for that player session without an audio bundle. The result is user-reported; the diagnostic output does not identify the video. It does not establish full-video coverage, arbitrary future-position acquisition, other-session compatibility, speech API acceptance or recognition quality. No real paid ASR request is reported.
- Build output and ZIP include the locally bundled googlevideo / protobuf code and license notices. There is no remote JS execution, runtime npm dependency or audio bundle requirement.

Earlier sections record historical versions and do not describe the current audio route. Current usage and limits: [SPEECH.zh-CN.md](SPEECH.zh-CN.md).

## 1.3.0 direct video audio and native fallback — 2026-09-13

- 83 JavaScript tests pass, including browser URL/byte limits, SABR detection, direct decoding/WAV upload, native fallback, pause/speed/seek scheduling, complete-cache reuse, timestamp mapping, cancellation and stale-job/sender rejection. Existing recording and translation tests remain green.
- Five Python tests pass: native framing/limits, input validation, actual FFmpeg encoding plus independent decoding, subprocess native protocol handshake/shutdown, and cancellation of a running child process. Test tones are explicitly synthetic.
- A real Chrome YouTube page for `wK3HbaVrDu0` exposed 18 audio format entries, none with a standalone URL or signatureCipher; streaming metadata contained `serverAbrStreamingUrl`, and the video used a blob source. This confirms the simple direct-URL route cannot serve that session; it does not prove every YouTube session is SABR-only.
- With yt-dlp 2026.8.19, the new helper downloaded the real 713-second Japanese track (9,820,719 bytes) in approximately 4.3 seconds, then produced a standalone 32-second WebM/Opus chunk (270,532 base64 bytes) from 120 seconds. No cookies or speech credentials were used. This is audio acquisition evidence, not speech-recognition evidence.
- The updated production popup was inspected in the labelled local browser fixture. Native protocol was checked as a subprocess; actual Chrome native-host registration/connection still requires the installed extension ID and reload. The browser tool rejects chrome://extensions/ navigation, so no internal-page workaround was attempted.
- Real paid ASR, resulting recognition quality, browser-to-provider upload acceptance and the complete installed-extension end-to-end path remain unverified. Pure-browser successful media download/decode is covered by fixtures, not a real standalone YouTube URL in this session.

The sections below are historical reports; the 1.3.0 audio workflow supersedes the earlier manual-recording-only limitation. Installation and current limits are in [SPEECH.zh-CN.md](SPEECH.zh-CN.md).

## 1.2.0 speech workflow and visual customization — 2026-09-12

`npm.cmd run verify`: **74 tests passed**, JavaScript checks passed, production build completed. The user has confirmed that basic functionality works following 1.1.1.

- Added four device-font families, four weights, line spacing, original/translation/background colors and UI accent. Validated finite numeric bounds and allowlisted font/color values. Preview/save/reset behavior and preserving independent translation engine selection are tested.
- Unified the player, fallback button, toolbar popup, Options header and browser icons around one vector mark. Exported 16/32/48/128 px PNGs from the same source; inspected the 128 px artifact. The renderer is development-only. Options now uses four compact sections and a bilingual appearance preview, with consistent Midnight/Mint themes.
- In Chrome's local playback fixture, selected Mint and Serif and confirmed the actual production overlay changed its theme and font. In the separate Options fixture, selected Serif and `#ffe088` translation text, clicked Save appearance and visually confirmed yellow Chinese text in the preview. Also inspected the popup at its 380 px body width. These fixtures explicitly simulate Chrome settings and permissions and never use real credentials.
- Speech readiness now catches missing endpoint permission, model and the built-in speech endpoint's absent key before capture. It exposes no key and makes no transcription request. Tests cover these conditions, explicit consent, paused playback, configuration deep link and completion/viewing action.
- The explicit View generated subtitles action enables/selects generated captions and seeks to the recorded clip, preserving paused state in the content integration test. The existing offscreen tests cover recording, WebM submission, timestamp mapping, pause/cancel and resource release.

**Limits:** No speech-recognition credential is configured for live testing, so real YouTube tab audio acquisition and a live timestamped transcription remain unverified. This version improves the existing short-clip workflow; it does not add full-video downloading, continuous live ASR or a bundled offline model. DeepL translation credentials cannot substitute for speech credentials. Installed 1.2.0 still needs an extension/YouTube reload; the browser tests above are local fixtures. The detailed steps and error meanings are in [中文语音字幕说明](SPEECH.zh-CN.md).

## 1.1.1 Options sender and initialization fix — 2026-09-12

`npm.cmd run verify`: **71 tests passed**, syntax checks passed, production build completed.

The user's `Unsupported sender.` and undefined `endpoint` reports exposed one failure chain: `ownPage()` required `!sender.tab`, but Options opened as a tab has tab metadata. The background rejected both reading and saving provider settings. Options then accessed `providers[id].endpoint` despite the failed initial load. A regression with a tab-shaped Options sender failed with `Unsupported sender.` before the production fix and passes afterward.

- The background now checks this extension's ID, URL protocol/host, exact allowed page path, and top-level frame. Options tabs and query/hash URLs are accepted; YouTube content scripts, foreign extension pages, path lookalikes and child frames cannot access credentials.
- Options disables configuration actions until a complete settings read succeeds. Rejected reads, incomplete provider records, and preference-read failures show an error and a retry action. Switching providers cannot throw or write empty configurations after a failed load; retry preserves the saved key.
- A combined test imports the actual Options and background modules, gives Options a tab sender, saves and selects MyMemory, tests its connection, and requests a translation as the YouTube content script. This closes the gap left by the earlier separate Options/background mocks.
- An explicitly enabled live run of that combined test made real MyMemory requests and returned **Hola, mundo.** for **Hello, world.** No API key was used. DOM, Chrome messages, storage and permission grants remain test fixtures; this is not an installed-browser end-to-end result.

To repeat the live fixed-greeting probe in PowerShell (requires network and sends the public greeting to MyMemory):

```powershell
$env:SENTENCE_LIVE_TRANSLATION = '1'
try { node --test --test-isolation=none tests/background.test.mjs }
finally { Remove-Item Env:SENTENCE_LIVE_TRANSLATION }
```

The earlier missing-key observation was a symptom, not a sufficient root-cause diagnosis: rejected Options requests prevented configuration from being saved. The prior free-standing browser lab did not exercise this sender authorization path. Installed 1.1.1 verification on YouTube remains pending an extension reload and provider connection. Existing browser-tool blocks on extension management/options pages were not bypassed. Source, `dist/` and ZIP contain the fix and no credentials.

## 1.1.0 provider and appearance update — 2026-09-12

**64 tests passed**, JavaScript syntax checks passed, production build completed.

- Nine translation engines: MyMemory, Google Cloud Translation, DeepL, Microsoft Translator, LibreTranslate, Custom AI/OpenAI, DeepSeek, Gemini and OpenRouter. Each has a prefilled endpoint. Live account/model access is provider-specific.
- New vector player icon with explicit centred alignment; Subtitles/Appearance tabs; Midnight/Mint themes; independent panel, subtitle background and text opacity; draggable subtitle position, size and translation/original ratio.
- Browser fixture checks confirmed Mint at 75% panel opacity and translated text at 125% size. A real mouse drag moved subtitle coordinates from (50%, 88%) to approximately (46.30%, 64.98%) while media remained paused.
- Automated pointer tests verify drag, scale, ratio, preview, persistence and reset. Provider tests verify Microsoft headers/region/schema and independent AI endpoints/context cache identity.
- Inspected the installed extension on the real target video: original captions were rendering, engine was DeepL and mode bilingual. The reported symptom was **missing API key in that extension profile's saved configuration**. The 1.1.1 investigation above subsequently found that Options requests were rejected before configuration could be saved. No key was read from storage. The previous issue where saving a translator did not select it is fixed: the explicitly labelled Save, connect & use action selects the engine and enables bilingual mode.
- A live MyMemory request through the production adapter returned a Spanish translation successfully. In Chrome, clicked the lab's explicit live-translation button, switched target to Chinese, and confirmed the production subtitle UI displayed **每一种新语言都开启了看待世界的不同方式。** beneath its original English sentence. The MyMemory adapter made real network requests; the lab banner explicitly identifies caption timeline and extension messaging as fixtures. This proves live API-to-subtitle rendering, but does not substitute for installed-extension permission/configuration verification on YouTube.

The browser URL policy blocks extension management **and extension options pages**. No raw browser commands or alternate access were used to bypass those blocks. The user must reload the extension and connect a provider in its options page; final installed 1.1.0 UI/provider validation is pending that action. No credential is included in source, docs or build output.


## 1.0.2 CC and player-entry fix — 2026-09-12

`npm.cmd run verify`: **61 tests passed**, syntax checks passed, production build completed.

Live inspection of the user's existing Chrome watch page `https://www.youtube.com/watch?v=KYDPpt3eqaQ` found:

- The English automatic track was discovered, but no timeline had loaded.
- Saved settings were translation-only with engine `none`, another path to an empty overlay.
- Changing to original-only and enabling native YouTube CC caused the installed observer to receive **288 reconstructed sentences**. The extension rendered original text at video time 962.397 seconds. This confirms that a complete track is accessible through native playback in this session; it is not a simulated caption fixture.
- The existing floating settings button opened through the browser accessibility click API. Earlier Playwright clicks/selectors did not reliably reach this shadow UI; an event conflict was suspected but not established as the root cause.

Version 1.0.2 adds automatic bounded native CC acquisition, restoration of its previous on/off state, handling of JSON XHR responses and observed responses arriving during a load, original-text fallback while translation is absent, and a button inside YouTube's control bar. Google Cloud Translation and DeepL use official APIs. Their auth headers, payloads, responses, missing-key errors and DeepL context cache identity are verified with synthetic responses; live paid requests were not made.

New tests also cover player-button event isolation/remounting, native acquisition after an empty direct response, original CC-off restoration, paused-state preservation, and translation-only without an engine.

**Installed 1.0.2 check:** pending manual extension reload. The browser tool blocks extension-management pages, so only the user can perform that reload. Actual CC observation above was verified with the prior installed build; do not treat it as proof that the new automatic activation or control-bar button has passed live testing yet.

The sections below record earlier development checks. Where they describe installed Chrome caption observation as unverified, the live 288-sentence result above supersedes that limitation for this specific session/video. Edge, full-screen, live Google/DeepL/AI and actual tab audio/ASR remain unverified.


## 1.0.1 debugging follow-up — 2026-09-12

The user reported missing subtitles on an already-open Chrome tab for `KYDPpt3eqaQ`. That tab was absent from both the available browser inventory and a fresh `openTabs` query, so its live extension state could not be inspected. The browser tool also blocks `chrome://extensions`; no workaround was attempted. The user was asked to connect/reference the exact tab. The reported video-specific root cause remains unconfirmed.

Local regression tests did reproduce two subtitle-discovery defects: a matching live player response without a caption list masked the initial response's available tracks, and a throwing player getter prevented the initial-response fallback altogether. Version 1.0.1 fixes both, retries briefly when metadata is ready but tracks are still absent, and logs content-module import failures instead of swallowing them. All **54 tests pass**; `dist/` and the ZIP were rebuilt. Installed-extension verification on the user's exact video is still required. The initial-delivery results below remain historical evidence.

Development completed on 2026-09-11/12 (America/New_York / UTC). Environment: Windows, Node 24.14.0, npm 11.9.0, desktop Chrome available through browser automation. No API credentials were supplied. No extension was installed into the user's browser profile.

## Executed successfully

- `npm run verify`: JavaScript syntax checks, **52 passing automated checks**, and a loadable `dist/` build. Tests include nested lifecycle checks; this count is Node's reported total.
- npm installation audit: **0 reported vulnerabilities** for the development dependencies at installation time. This is not a continuing security guarantee.
- **Live MyMemory request**: production adapter translated `Hello, world.` from `en` to `es` and returned `Hola, mundo.`. No API key or personal input was used.
- **Live YouTube metadata probe**: fetched the public watch page for `UF8uR6Z6KLc` (Stanford's Steve Jobs address). Player status `OK`; nine caption tracks were discovered: Arabic creator, English automatic, English creator, Italian creator, Japanese creator, Khmer creator, Portuguese-Brazil creator, Spanish creator and Spanish-Spain creator.
- **Live YouTube caption request**: requested JSON3 from a discovered signed track URL. The server returned **HTTP 200, zero-byte body**. This is a failed extraction attempt, not a successful subtitle download. It drove implementation of the native-player-response observation fallback and explicit error/recovery UI.
- The live browser displayed native caption text on public YouTube playback. This confirms native player caption availability in that browser session, **not** successful extraction by this extension.

## Automated test coverage

| Area | Checked behavior | Test environment |
| --- | --- | --- |
| Sentence processing | Fragment merging, separate intervals for multiple sentences, CJK punctuation, abbreviations/decimals, silences, long-sentence boundaries, rolling repeats, invalid cues, JSON3 word offsets | Pure Node tests |
| Navigation | Lookup in gaps, first/last bounds, previous/next behavior, paused/playing preservation, typing/composed-path guards, modifiers and ads | Pure functions + happy-dom content script |
| Player lifecycle | Shadow overlay rendering, native caption suppression/restoration, source/engine separation, speed feedback and popup commands, SPA transitions, late translation rejection, generated-source selection, cleanup off watch pages | Production content script with DOM and Chrome message fixtures |
| Providers | AI endpoint/model/context/auth contract, LibreTranslate JSON schema, MyMemory URL/status/UTF-8 limit, malformed/empty replies, HTTP/quota redaction, cancellation, multipart ASR format | Production adapters with stub fetch responses |
| Cache | Engine/model/endpoint/language/context identities, key rotation independence, hits/replacement, expiry, 10,000-record pruning, explicit clear | fake-indexeddb |
| Page bridge | Track classification/defaults, no signed URLs in discovery replies, discovered-URL validation, current video validation, session credential request, empty body error, observed-response reuse | Production bridge in VM with player/network fixtures |
| Privileged worker | Trusted storage access, withholding keys from content scripts, rejecting unknown senders, no capture on source selection, required popup consent, playback validation, one-session reservation, navigation cancellation, lost-offscreen recovery | Chrome API fixtures |
| Audio lifecycle | Worker-only control, audio-only tab constraints, no upload at start, bounded timer, track/context release, multipart submission after finish, timestamp origin, pause/cancel without upload | Simulated MediaRecorder/Web Audio/Chrome APIs |

These tests do not prove browser permissions, real codecs, authenticated YouTube behavior, provider billing behavior or model quality.

## Rendered browser checks

Used `npm run lab` to load the production content script against explicitly labelled local fixtures in desktop Chrome.

- Inspected subtitle rendering and compact settings visually. Original and translated complete sentences were readable. Fixed the panel stacking order so subtitle lines do not cover its controls; applied dark control/scrollbar styling.
- Right Arrow moved from the first to second sentence at **9.005 seconds** while keeping playback **paused**.
- Changed to **translation only** and observed only the Spanish sentence.
- Increased speed to **1.25×**, reflected in both the player panel and actual media element.
- Disabled the extension and observed the **native-caption placeholder return**, with custom text removed.
- With media playing at 1.25×, Right Arrow moved to **19.005 seconds**, and the browser's media element reported **paused: false**.
- A real fullscreen API request was attempted, but this automation context returned **`TypeError: not granted`**. Fullscreen remains a manual acceptance check. Keeping the overlay inside the fullscreen player is implemented; successful real fullscreen behavior is not claimed.

The lab's tracks, translations, extension messaging and silent media are fixtures. It is included for reproducible UI checks and is excluded from `dist/`.

## Not verified live / remaining acceptance checks

1. **Installed unpacked extension in Chrome and Edge**: the manifest and files are built, but real extension loading, worker startup and permission prompts were not exercised. Edge was not available to the browser automation tool.
2. **Authenticated caption extraction and observer fallback**: after loading unpacked, reload a YouTube watch page, select creator English, then automatic English. Enable native CC/select the language and Refresh tracks if direct fetch is empty. Confirm the extension obtains an actual timeline. Repeat on a video without captions, and navigate to another video without a full reload.
3. **AI and LibreTranslate live accounts**: configure a reachable endpoint/key/model and use the explicit test button. Contract tests pass; no real AI/LibreTranslate endpoint was available. Verify translation quality and language support yourself.
4. **Actual tab audio acquisition and paid speech recognition**: no real tabCapture stream or paid ASR request was initiated. The documented API architecture and lifecycle were tested with simulations. On an installed extension, record 15 seconds of audible speech, finish, and replay to verify actual audio output, provider acceptance and timestamp alignment. Do not infer live audio success from the silent browser lab.
5. **Native fullscreen and browser-specific edge cases**: test with YouTube's own fullscreen button and exit fullscreen; test theater mode, prolonged buffering, mid-roll ads and browser restart during capture. Test a custom provider's CORS/permission/TLS behavior after granting its origin.

## Manual acceptance sequence

1. Install `dist`, reload YouTube, leave translation engine off. Creator captions should load or produce a specific recovery message. Native captions should remain usable if no timeline is available.
2. Switch among creator, automatic, an unavailable language, and Generated speech. None of these actions should prompt for billing or start audio capture.
3. Connect MyMemory, select Spanish and bilingual mode. Check sentence text, source labels, lookahead, seeking and cache reuse. Switch original-only and verify no further translation requests; switch translation-only and verify original lines disappear.
4. While paused, use Right then Left. Repeat while playing. Type in YouTube search/comments and move their cursor with arrows. Disable shortcuts and confirm YouTube seeking resumes.
5. Change speed via YouTube, then the extension. Enter/exit fullscreen and navigate to another video. Check for duplicate overlay instances and old-video text.
6. Configure a timestamp-capable speech model. Verify Start is unavailable until consent and valid 1× playback, then record a bounded clip. Close/reopen popup, finish, and select Generated speech to replay it. Record a second nonoverlapping clip and confirm both portions are retained during this page session.
7. During a recording, pause, seek, change speed, navigate, disable the extension or close the tab. Each should stop capture/discard unsubmitted audio. Simulate a bad key, quota error, network error and text-only ASR response; check errors and ability to initiate a fresh recording.
8. Disable the overlay and confirm native CC visibility and keys return. Clear cache and Forget key in provider settings. Reload the extension and page after an update.

## Probe commands

Download only a public page you are allowed to access; do not paste cookies or signed caption URLs into issue reports.

```sh
curl -L -o youtube-probe.html "https://www.youtube.com/watch?v=UF8uR6Z6KLc"
node scripts/probe-youtube.mjs youtube-probe.html
node scripts/probe-youtube.mjs youtube-probe.html --fetch
node scripts/probe-providers.mjs
```

The probe prints track metadata and HTTP/body status, not signed URLs. It saves nonempty JSON captions to ignored `artifacts/live-captions.json` only if extraction succeeds. The raw watch-page probe was removed from this delivery after inspection; there are no exported cookies, signed URLs or credentials in the shipped extension.
