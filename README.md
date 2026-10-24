# Executive Decision Maker

A 3D, in-browser tribute to the classic Radio Shack *Executive Decision Maker* desk gadget: a flat rosewood-vinyl box with beveled brushed-aluminum walls and a sloped smoked-glass faceplate over six red LEDs.

Press **ASK** (or Space / Enter). The light chirps its way around every answer a few times, slows down and stops on a decision, which stays lit until you ask again. Slide the switch to turn it off. Drag to look around.

Fan-made; not affiliated with RadioShack.

## Run locally

It is a static page with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Tech

- [three.js](https://threejs.org) 0.170.0 loaded from jsDelivr via an import map
- Physically based materials: transmissive smoked acrylic, clearcoat, anisotropic brushed metal, procedural rosewood vinyl and smudge maps
- Area-light softbox, soft VSM shadows, GTAO ambient occlusion, depth of field, selective LED bloom, MSAA, film grain
- Web Audio for the piezo chirps and switch clicks
- Lighter settings (no depth of field, fewer AO samples) on touch devices

## Deploy to GitHub Pages

Push to a GitHub repo, then **Settings → Pages → Deploy from a branch → `main` / root**.
