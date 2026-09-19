# README screenshots

Captured in desktop Chrome on 2026-09-18, using the production extension UI in local fixtures. Only the screenshot bounds were cropped; no subtitle or interface text was composited or replaced in the images. The fixtures use synthetic media and predefined captions/translations, not a live YouTube or model request.

- `bilingual-reading.jpg`: refreshed on 2026-09-19 at `/watch?v=abcdefghijk&showcase=1`, **Go to first sentence**, settings closed. English source ("Every new language opens a different way of seeing the world.") and Chinese translation ("每学会一种语言，就多一种看世界的方式。") are predefined in `lab/mock.js`. Shows the production subtitle renderer over the lab's original graphic background.
- `appearance-controls.jpg`: `/lab/pages.html`, **Appearance**, default Mint theme. Captured the complete Colors & typography section, including the production bilingual style preview.

Run `npm run lab` from the project root to reproduce these views at `http://127.0.0.1:4173`. No provider credentials are needed. These screenshots demonstrate UI layout, not live transcription, translation quality, or YouTube compatibility.
