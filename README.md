# Monsoon Chimes

A hands-first WebXR music garden — an entry for the Meta VR Start Developer
Competition 2026 (Track: Entertainment, Division: New Experience).

Sit beside a lotus pond at dusk in the monsoon rain. Eight brass chimes float
in an arc in front of you. Reach out and strike them with your hands to play
notes, or follow a melody note by note.

## How to play

- **Free Play** — strike any chime freely. Every strike adds to your score.
- **Follow the Melody** — pick one of three short original melodies
  ("First Rain", "Lotus Bloom", "Monsoon Night"). Watch and listen as the
  chimes light up in sequence, then repeat the melody yourself. Correct notes
  build your combo; finish a melody to earn 1–3 stars and a firefly celebration.

## Controls

- **In VR (Quest 3 / 3S):** use your hands — pass a fingertip or palm through
  a chime to ring it. No controllers needed (controllers work too, as pointers).
  Seated play; everything is within a comfortable central field of view.
- **In a flat browser:** move the mouse (or your finger on touch screens) —
  a glowing hand follows your pointer. Move it through a chime, or click / tap
  a chime, to ring it. The **Enter VR** button appears only when the browser
  reports immersive-VR support.

## How to run

Any static web server works. From this folder:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. For VR, serve over HTTPS (or `localhost`,
which browsers treat as a secure context) and open the page in the Quest
browser.

## Technical notes

- **Stack:** Three.js (pinned 0.170.0, MIT license — vendored in
  `vendor/three.module.js`, see the license header in that file) + WebAudio.
  No build step, no other dependencies.
- **All content is original and procedural:** every mesh is built from
  Three.js primitives at runtime; every sound is synthesized with WebAudio
  (pentatonic scale C–D–E–G–A, chime tones from sine partials, rain from
  filtered noise). No downloaded images, models, audio, or copied code.
- **Performance (Quest 3 target: 60 fps):** low-poly geometry, no
  post-processing, pixel ratio capped at 1.5, a few hundred draw calls at most,
  simple standard materials, fog and points for atmosphere.
- **Files:** `index.html` (page + UI), `app.js` (scene, audio, interaction,
  game logic, WebXR hand tracking), `vendor/three.module.js` (Three.js 0.170.0).

## Known limits

- A real immersive-VR session with hand tracking has not been tested here
  (no headset available in this environment). The hand-tracking path uses the
  standard WebXR API (`XRInputSource.hand`, `frame.getJointPose`, joint
  `index-finger-tip` / `thumb-tip` / `middle-finger-tip` / `palm`) and the
  desktop fallback (mouse/touch as a virtual hand) is fully testable in any
  browser.
