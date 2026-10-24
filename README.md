# Executive Decision Maker

A 3D, in-browser tribute to the classic Radio Shack *Executive Decision Maker* desk gadget: a flat rosewood-vinyl box with beveled brushed-aluminum walls and a sloped smoked-glass faceplate over six red LEDs.

Press **ASK** (or Space / Enter). The light buzzes its way around every answer a few times, slows down and stops on a decision, which sweeps across the screen game-show style and stays lit until you ask again. Slide the switch to turn it off. Drag to look around.

## Monthly themes

The backdrop changes with the month. October is a moonlit Halloween night: carved jack-o'-lanterns with flickering candles, fallen leaves, tombstones, bare trees, bats and a cobweb on the device, with the answer wipe and loading screen in orange and purple. Other months use the studio set for now. Preview any theme with `?theme=halloween` or `?theme=studio`; themes live in `themes.js`.

## Randomness

Each answer is drawn from true random bytes from [random.org](https://www.random.org) (atmospheric noise), hashed with SHA-256 together with the browser's cryptographic RNG, then reduced to one of six answers by rejection sampling so none is favoured. If random.org can't be reached the page carries on with the browser RNG alone; the footer says which was used. Fetching from random.org means each visitor's browser contacts random.org.

## Sound

The buzzer is modelled on a recording of a real unit: about 1.27 kHz with strong 2nd and 3rd harmonics, 40 ms per step every 60 ms, with the little pitch blip as each beep starts and stops.

While it loads, a retro pixel-art loading screen shows real progress, then wipes away. Overlays fade out after a few seconds so you're left looking at the device; move the mouse or press a key to bring them back.

Fan-made; not affiliated with RadioShack. The faceplate lettering and wordmark are set by hand to match photos of a real unit, not copied from logo artwork.

## Privacy

No cookies, analytics or tracking. The page loads three.js from jsDelivr (pinned to 0.170.0, with integrity hashes) and, the first time you press or type, fetches 64 random bytes from random.org; those are the only third-party requests, so jsDelivr and random.org see your IP address. Fonts are self-hosted. The only thing stored is your mute setting (localStorage).

## Run locally

It is a static page with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Tech

- [three.js](https://threejs.org) 0.170.0 loaded from jsDelivr via an import map
- Physically based materials: transmissive smoked acrylic painted on the back except the windows, a red PCB with traces and resistors underneath, anisotropic brushed aluminum, matte rosewood, fine dust
- 4K procedural textures (add `?tex=2048` or `?tex=1024` to the URL on slower machines)
- Area-light softbox and studio environment, soft VSM shadows, GTAO ambient occlusion, selective LED bloom, MSAA, film grain
- Web Audio for the buzzer, switch clicks and the answer whoosh, unlocked on the first interaction (Safari included)
- Fonts: Montserrat and Montserrat Alternates for the faceplate, Press Start 2P for the loader (Google Fonts, OFL)
- 2K textures and fewer AO samples on touch devices

## Tests

`tests/run_tests.py` runs end-to-end checks in Google Chrome under the site's real Content-Security-Policy: loading in both themes, decisions, power, keyboard and touch use, the wipe, mute, idle overlays, random.org being unreachable, an even spread of answers, graphics-context recovery, reduced motion and failure handling.

```sh
pip install playwright
python3 tests/run_tests.py
```

Add `?debug` to the URL to expose the test hooks on `window.__edm`.

## Deploy to GitHub Pages

Push to a GitHub repo, then **Settings → Pages → Deploy from a branch → `main` / root**.
