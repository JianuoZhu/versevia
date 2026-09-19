# Versevia · User Guide

[中文 README](../README.md) · [Changelog](../CHANGELOG.md)

A Manifest V3 extension for desktop Chrome and Edge. It displays and navigates reconstructed caption sentences on `https://www.youtube.com/watch` pages, with independent subtitle sources and translation providers.

**Project layout:** extension source in `extension/`, SABR source in `src/`, generated builds in `dist/`, automated tests and a local browser lab. Protocol code is bundled; end users need no runtime, companion program or audio bundle.

**Semantic processing:** AI semantic sentence boundaries, contextual batches of up to 48 sentences, and aligned bilingual clauses for long-sentence display. Source timestamps remain authoritative; within-cue boundaries are interpolated. Automated tests and the labelled Chrome lab exercise the implementation with simulated provider output; real-model segmentation/translation quality remains unverified. See [中文断句说明](SEMANTIC.zh-CN.md), [verification](VERIFICATION.md) and [speech setup](SPEECH.zh-CN.md).

**Scheduling:** New semantic windows preserve in-flight translation/alignment when their source sentences are unchanged, including positional ID shifts. Seeking prioritizes the new position in both nearby and whole-video modes. Unrelated requests are aborted, completed work is retained, and old translation backfill waits for current-position semantics. Reload the extension and existing YouTube tabs.

## Install a release build

Build the source with `npm ci` and `npm run build`, or download and extract [versevia-extension.zip](https://github.com/JianuoZhu/versevia/releases/latest/download/versevia-extension.zip). A source checkout does not include `dist/`.

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json` (or `dist/` when building from source).
3. Reload existing YouTube tabs so the caption observer starts before the player requests captions.
4. Open a regular YouTube watch page. Click **文 A** in the bottom player control bar, alongside YouTube CC/settings. The upper-left button is a fallback only while YouTube has not mounted its control bar.
5. Select the source type and source language, then an available track. **Best available track** prefers creator captions in the player's default caption language, falling back to the browser language when no default is exposed.

Chrome 116+ is required for the service-worker-to-offscreen audio capture workflow. Edge must provide the equivalent Chromium APIs. Mobile YouTube, embedded players, Shorts, live streams and other websites are outside this release's supported scope. Do not enable incognito access for this build; split/incognito sessions have not been validated.

The included ZIP, `versevia-extension.zip`, contains the same loadable files; extract it to a folder before using Load unpacked. It is not a signed `.crx` or a store submission.

`native/` contains historical 1.3.x sources. Current releases do not use native messaging or require an audio bundle.

## Build and verify

Use Node.js 20.11+ (tested with 24.14.0). PowerShell users can invoke `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm ci
npm run verify
```

`verify` builds the bundled protocol code, checks JavaScript syntax and runs tests. Install the locked development dependencies with `npm ci` before building:

```sh
npm run build
```

After rebuilding, reload the extension from the browser's Extensions page and reload YouTube tabs. `happy-dom` and `fake-indexeddb` are development-only dependencies used for tests; neither is copied to the extension.

**Updating from versions before 1.5.0:** Reload the existing extension and YouTube tabs. Existing provider settings are preserved. AI semantic sentences are enabled by default for the selected AI provider; disable the checkbox in the player or Reading settings to return to rule-based segments. Original-only mode can still incur semantic-processing requests when this is enabled. Previous translation-batch cache entries are bypassed because the prompt and context identity changed; speech caches remain valid.

For the browser lab:

```sh
npm run lab
```

Open `http://127.0.0.1:4173/watch?v=abcdefghijk`. It uses the **production content script** with clearly labelled simulated captions, translations, extension messaging and a silent media track. Click **Test real MyMemory translation** to use the live public API for these demo sentences (no key required). The banner distinguishes live translation from simulated responses. The lab does not test real YouTube authentication or Chrome's extension capture permissions. Stop the server with Ctrl+C.

## Read and navigate

With an AI provider selected, semantic processing identifies complete sentences from overlapping source windows before translation. It returns immutable source indexes only. Long sentences retain a single navigation target but can display as model-selected natural clauses after bilingual alignment. Layout targets roughly two lines per language; grammar and correspondence take priority over that target. Pending or failed processing explicitly shows temporary source captions. When semantic processing is disabled or a conventional provider is selected, rule-based reading fallbacks use 48 CJK characters / 120 otherwise, seven seconds and 0.7-second gaps. Word timestamps are retained when supplied; splits inside a timed cue use proportional estimates. No audio forced alignment is added.

- Choose **Creator subtitles**, **YouTube automatic**, or **Generated speech** independently of **MyMemory**, **Google Translate**, **DeepL**, **Microsoft Translator**, **LibreTranslate**, **DeepSeek**, **Gemini**, **OpenRouter**, or **Custom AI**.
- Use **Match video** to select from available languages automatically, or choose a language and track explicitly. An unavailable source stays unavailable; it never silently initiates paid transcription.
- Choose original only, translation only, or original plus translation. Translation starts only after an engine is selected and its endpoint is connected; original-only mode makes no translation calls. Translation-only mode temporarily displays the original while its translation is pending, unavailable or the engine is disconnected; the original disappears when that sentence's translation is ready.
- **Right Arrow** moves to the next sentence start. **Left Arrow** moves to the previous sentence, even when partway through the current one. In a silence, Left selects the last preceding sentence. At the first/last sentence, an unavailable jump is a no-op.
- Navigation preserves playing/paused state. Typing fields, editable areas, selectors, buttons, sliders, menus and modified shortcuts keep their normal keys. Disable the sentence shortcuts to restore YouTube's arrow seeking.
- Use − / speed / + in the player panel, or the speed selector in the toolbar popup. Click the displayed rate to restore 1×. YouTube's own playback-rate changes are reflected automatically; speed is not forced across videos.
- Disable the overlay to restore native caption visibility and native arrow keys. The extension suppresses native caption rendering with a scoped CSS class while its timeline is active. When direct caption loading fails, it briefly enables native CC to let YouTube request an authorized track, then restores the original CC on/off state after acquisition or a 15-second timeout. Manual CC clicks during loading take precedence. Disabling, switching to generated speech or leaving the video also ends that temporary activation.

## Appearance and direct mouse editing

Open the player icon, then **Appearance**. Choose **Midnight** or **Mint**. Panel opacity, subtitle background opacity and subtitle text opacity are independent. The original text is adjustable from 16–64 px; translated text is 50–180% of that size. Settings persist in the browser profile.

Select **Adjust subtitles with mouse** to close the panel and expose editing handles. Drag the text or **Move** handle to reposition; drag **Size** to resize both lines; drag **Ratio** vertically to change only the translation size. Scrolling over the subtitle area scales both lines; Shift + scroll changes the ratio. **Done** locks the overlay so normal player interactions work again. **Reset subtitle layout** restores the default position, size and ratio. Horizontal positioning adjusts the available wrapping width to keep text within the player.

The player icon is a new vector speech/caption mark, centred with flex alignment in the native control bar. It has no font-dependent Chinese glyphs and remains sharp at different display scales.

Choose system, humanist, serif or monospace subtitles, four font weights, line spacing from 1.1–2×, original/translation/background colors and a UI accent color. Font choices use device fonts with fallbacks, without downloading fonts. Color and typography changes preview immediately in the player; **Reset colors & typography** restores defaults. The settings page includes a bilingual preview and an explicit **Save appearance** action. Its Providers, Reading, Appearance and Local data sections avoid a single long form. The toolbar popup uses the same saved theme and accent when opened.

The browser toolbar and extension-management icons are PNG exports of the same vector used in the player and settings header. To regenerate them after changing the mark, run `npm run icons` after `npm ci`, then rebuild. `@resvg/resvg-js` is a development-only renderer; assets are included, so a normal extension build needs no rendering dependency. Local visual fixtures are at `/lab/pages.html` and `/lab/pages.html?view=popup` on the lab server; all settings and permissions there are simulated.

## Connect a translation provider

**Latency diagnostic:** Providers includes **Compare Luna latency · 6 paid requests** for an existing official GPT-5.6 Luna configuration. It compares default/low/none with fixed synthetic text and reports complete-response latency, reasoning tokens and translations without changing normal settings. [中文诊断结果及调度修复](LATENCY.zh-CN.md).

Open **Providers** in the player or **Languages & providers** in the toolbar popup. Select a provider, save its prefilled endpoint and your credentials, and approve the browser's permission for that endpoint origin. The **Save, connect & use** action also selects the translator and switches to bilingual mode, so a saved configuration is immediately usable. Speech-provider saves never start recording. Source selection does not change when you switch engines.

| Provider | Full endpoint | Key / model |
| --- | --- | --- |
| MyMemory | `https://api.mymemory.translated.net/get` | No key needed for its limited public quota; optional MyMemory key |
| Google Translate | `https://translation.googleapis.com/language/translate/v2` | Google Cloud Translation Basic API key; enable the API and configure billing/quota |
| DeepL | `https://api-free.deepl.com/v2/translate` (API Free) or `https://api.deepl.com/v2/translate` (API Pro) | DeepL API key; no model field |
| LibreTranslate | `https://libretranslate.com/translate` or your own `/translate` route | Hosted services may require a key; no model field |
| Microsoft Translator | `https://api.cognitive.microsofttranslator.com/translate` | Azure subscription key and region when required |
| DeepSeek | `https://api.deepseek.com/chat/completions` | DeepSeek key and supported model ID |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | Google AI Studio key and supported Gemini model ID |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | OpenRouter key and exact provider/model slug |
| Custom AI | e.g. `https://api.openai.com/v1/chat/completions` | Your service's API key and exact Chat Completions model ID |

**MyMemory** uses its real translation-memory/MT API, with MT enabled by the service's default. It accepts at most 500 UTF-8 bytes per sentence; long CJK sentences can exceed that even when character count is low. Choose LibreTranslate or AI if this happens. Quotas and language-pair availability are provider-controlled. The adapter uses GET, so sentence text and an optional key appear in the provider request URL; consider its retention policy before using it with nonpublic material. It never calls the contribution endpoint. [API specification](https://mymemory.translated.net/doc/spec.php).

**Google Translate** uses the official Cloud Translation Basic v2 JSON API with `format: "text"`. Create a Google Cloud project, enable Cloud Translation, configure its billing/quota, and use a key restricted to that API. The key is sent in the `X-Goog-Api-Key` header, not a URL. This requires a Cloud API account; it does not scrape the free Translate website. [Translation API](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate), [header authentication](https://docs.cloud.google.com/docs/authentication/rest).

**DeepL** uses the official API with `Authorization: DeepL-Auth-Key …`, a `text` array and neighbouring sentences in `context`. Choose API Free or API Pro and paste the matching endpoint and API key. An ordinary DeepL translator subscription does not supply API access. Generic English targets use EN-US; Portuguese uses PT-PT; Chinese uses simplified ZH-HANS or traditional ZH-HANT. [API access](https://developers.deepl.com/docs/getting-started/auth), [context behavior](https://developers.deepl.com/docs/learning-how-tos/examples-and-guides/how-to-use-context-parameter).

**LibreTranslate** sends `q`, `source`, `target`, `format: "text"`, and optional `api_key` in a JSON POST. A self-hosted example endpoint is `http://localhost:5000/translate`; run and manage that server separately. Provider installation is not bundled with this extension. [LibreTranslate API](https://docs.libretranslate.com/api/operations/translate/).

**Microsoft Translator** uses Text Translation v3 with the version and language parameters added by the adapter. Enter the Azure region for regional or multi-service keys. [Microsoft authentication](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/authentication).

**DeepSeek**, **Gemini** and **OpenRouter** each have an independent preset, saved key and model setting. They share the Chat Completions adapter but keep their own provider identity and cache. Choose a model supported by the account rather than assuming a model is universally available. [DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/), [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai), [OpenRouter endpoint](https://openrouter.ai/docs/quickstart).

**Custom AI** uses a JSON POST with `model` and `messages`, then reads `choices[0].message.content`. Translation includes preceding/following context and accepted translation references; missing, duplicate, unknown or empty sentence results are rejected. No model is guessed or silently substituted. Semantic/alignment requests to the official OpenAI endpoint use strict JSON Schema; compatible endpoints receive a JSON-output instruction. It expects nonstreaming Chat Completions, not a Responses endpoint. Remote endpoints require HTTPS; HTTP is permitted only for `localhost` and `127.0.0.1`. [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

The **Test translation · may cost** button submits only “Hello, world.” for Spanish translation using the **saved** configuration. It is an explicit provider request and may incur a charge. Automated verification uses simulated provider responses; it does not establish live model quality.

Semantic AI translations start with up to eight ready sentences (two in rule-based mode), then prefetch up to 48 sentences / 24,000 source characters, with a 16,000-character single-sentence limit. Each batch gets up to eight neighbouring segments on each side, capped at 4,000 characters per side, plus up to eight accepted translation pairs capped at 4,000 combined characters. Conventional providers retain their single-sentence adapters and two-sentence lookahead. **Translate whole video** fills all loaded source text and translations; **Stop translation** cancels semantic/translation work while retaining completed results. **Resume nearby** resumes local prefetch. Seeking prioritizes the new position. Only completed semantic sentences enter translation when semantic processing is enabled. Newly generated source text revisits the previous final 15 seconds to avoid freezing an unfinished utterance.

A provider failure pauses its task until **Retry subtitle processing** or a configuration change. Semantic/alignment structural failures get at most one repair request; HTTP failures and translation failures are not automatically retried. AI requests have a 90-second timeout; traditional requests retain 25 seconds. Semantic, alignment, translation and speech caches share a 30-day TTL and 10,000-record cap. AI translation cache identity includes the complete batch context and reference translations, along with engine, endpoint, model, languages, source and prompt version. Changed wider context invalidates reuse. Rotating a key does not invalidate cache entries; use **Clear translation cache** when needed.

Rule-based fallback handles multilingual punctuation, abbreviations, Unicode word/grapheme boundaries and rolling-caption deduplication. Semantic mode uses the same normalized source but leaves sentence boundaries to the selected model. Both depend on source timing quality; neither adds audio alignment.

## Generate subtitles from video audio

1. Configure the speech endpoint, key and a model returning timestamped `verbose_json` segments. Translation configuration is separate.
2. Choose **5 minutes near current position** or **Full video**, check audio-processing consent, and click **Generate from video audio**. Optional permissions are requested on this explicit click.
3. The extension identifies the active SABR audio track and requests its WebM segments entirely in the browser. Without SABR metadata, a single-language standalone audio URL can be used (15 minutes / 20 MB maximum). Ambiguous dubbed tracks are rejected.
4. Use **Test browser audio · no speech API** first to verify the current player session without an API key or paid upload.
5. Recognition runs in approximately 30-second intervals with one-second context overlap. Completed subtitles appear immediately and are cached for 30 days; subsequent runs skip completed intervals. Pause, speed changes and seeking do not interrupt this mode.

Only one audio job runs at once. Changing videos, disabling the extension, changing speech/source settings, or clicking Cancel stops remaining work. Already accepted speech requests may still be charged. Protected/live videos are unsupported. SABR uses transient native player request context and does not export browser cookies. SABR downloads and transcribes one interval at a time; standalone URLs download the full audio first. Initial readiness depends on session compatibility, network and provider speed.

The **Manual recording fallback** retains the previous explicit 15/30/60-second tab recording workflow. Only that fallback requires uninterrupted 1× playback and replay; its results are page-memory-only.

See [中文语音字幕说明](SPEECH.zh-CN.md) for setup, limits and verification commands.

## YouTube extraction and recovery

The MAIN-world bridge checks the current player's response and the initial player response **only when the video ID matches the watch URL**. It distinguishes creator tracks from `kind=asr`, requests a discovered `/api/timedtext` URL in the page session, and parses JSON3 or XML. It also observes text and JSON responses to the player's native `fetch` and XHR caption requests. Cached observed responses are limited to eight tracks and 5 MB per track and are never persisted.

YouTube's internal page and timedtext interfaces are undocumented and can change. They may require player-generated tokens, return an empty body despite HTTP 200, or withhold captions for a particular session/video. The bridge does not invent tokens or bypass restrictions. If the direct request fails, the extension automatically asks native CC to load the selected discovered track once. It observes the resulting authorized response instead of recreating player tokens. If that bounded recovery fails, enable YouTube's native CC (and choose the desired native language), then use **Refresh tracks**. Reload the page after installing/updating the extension so early caption requests can be observed. If unavailable, use a different source or explicitly record a clip. No public-video subtitle access through the official Data API is assumed: its download method requires permission to edit the video. [YouTube caption-download authorization](https://developers.google.com/youtube/v3/docs/captions/download).

Semantic sentence and display-clause timelines are distinct: navigation uses full sentences, while each display clause inherits its original source range. Rule fallback continues to use a shared display/navigation timeline. Neither route can guarantee perfect boundaries or timing from inaccurate source captions.

## Privacy and permissions

- YouTube host access loads the player interface and discovers captions. `activeTab` plus `tabCapture` is used only on explicit toolbar initiation; `offscreen` holds the recorder and audio playback path. Chrome documents the worker/offscreen capture flow starting in version 116. [Capture architecture](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture).
- Optional host patterns allow users to connect their own endpoint origins. The extension requests only the chosen origin at configuration time. Permission applies to that whole origin, as Chrome host permissions do. To revoke it, use the extension's site-access settings in Chrome/Edge. Forgetting a key does not revoke host permission.
- Keys and preferences use `chrome.storage.local`, with access restricted to `TRUSTED_CONTEXTS`; keys never pass through the MAIN-world bridge or YouTube content script. They are not synced or encrypted as a vault. Use revocable, limited keys for personal use. A distributed multiuser product should use a server-side credential proxy rather than embed shared credentials. [Storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage).
- Provider responses are rendered as text, not HTML. Redirects are rejected, credentials are omitted from provider cookies, and upstream error bodies are not reflected to the page. TLS errors are not bypassed.
- Browser audio exists in memory; no local helper or temporary audio files are required. Generated text is cached locally for 30 days. Caption text goes to the selected translator, neighbouring context also goes to AI and DeepL, and explicitly recorded audio goes to the speech endpoint. Processing/retention at those providers follows their policies. This extension adds no analytics or telemetry.

## Extend or inspect

See [architecture and adapter contract](ARCHITECTURE.md) and [verification / manual acceptance checks](VERIFICATION.md).
