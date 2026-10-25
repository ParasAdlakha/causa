# Media scripts

How the slides, deck, screenshots and videos in [`docs/`](../../docs) were made. They are not needed to run Causa.

**Requirements:** Node 22+, Google Chrome, [ffmpeg](https://ffmpeg.org/) and ffprobe on the PATH, and `pip install edge-tts` for the voice-over. Then run `npm install` in this folder. If Chrome isn't at the default Windows path, set `CHROME_PATH`.

| Script | What it does |
|---|---|
| `render.mjs` | Renders every `.frame` in `docs/slides/slides.html` to a PNG: the 8 slides (`s1`–`s8`) plus the LinkedIn images (`g-cover`, `g-loop`, `g-product`) |
| `build-deck.cjs` | Builds `Causa-slides.pptx` from the slide PNGs, with the spoken script in the speaker notes |
| `record-live.mjs` | Drives one real investigation in the web UI (live Zetaris and Nemotron). It records timestamped screencast frames, marks the key moments (plan, first query, critique, answer, citations, follow-up) and saves the screenshots in `docs/img/` |
| `causa-video.mjs` | Edits that one recording into the three videos. Segments between marks play in real time, or are sped up and labelled "sped up N× · real run" to fit their narration. Captions are image overlays; the voice is edge-tts (`en-US-AvaNeural`) |

```bash
cd scripts/media && npm install

# slides and LinkedIn images (move the g-*.png files to docs/img/ as linkedin-*.png)
node render.mjs ../../docs/slides/slides.html ../../docs/slides
node build-deck.cjs ../../docs/slides ../../docs/slides/Causa-slides.pptx
# PDF: export the .pptx from PowerPoint (File → Export → PDF)

# record a live run: Causa on :3100 with Zetaris and Nightshift online (takes 10–20 minutes)
node record-live.mjs http://localhost:3100 ./rec ../../docs/img

# the videos, from that recording
node causa-video.mjs 2min      ./rec ../../docs/slides ../../docs/video/Causa-demo-2min.mp4
node causa-video.mjs 3min      ./rec ../../docs/slides ../../docs/video/Causa-pitch-3min.mp4
node causa-video.mjs captioned ./rec ../../docs/slides ../../docs/video/Causa-demo.mp4
```

The narration and captions are in `causa-video.mjs`, and the speaker notes are in `build-deck.cjs`. Editing a long sped-up segment decodes thousands of frames, so each video takes 15–30 minutes on a laptop.
