# Bolt Run

A small endless runner written in plain HTML, CSS and JavaScript using Canvas 2D. It has no libraries, no build step and no backend.
You play Bolt, a tiny scarf-wearing robot. Jump the crystal spikes and dodge the patrol drones.

## Run it

Open `index.html` in any modern browser. That's all you need.
You can also serve the folder if you prefer: `python3 -m http.server` → http://localhost:8000

## Playing on iPhone / iOS Safari

The game is built to work in iOS Safari (iOS 13 and later) and other mobile browsers:

- **Touch:**
  - Tap anywhere on the game to jump, and hold for a higher jump.
  - Pinch-zoom, double-tap zoom, the long-press magnifier and page bounce are turned off on the game area.
- **Sound:**
  - Audio unlocks on your first tap and comes back after you switch apps.
  - iOS mutes web audio when the ring/silent switch is set to silent. Flip the switch to hear sound.
- **Screen fit:**
  - The layout respects the notch and home indicator.
  - It works in portrait and landscape. Landscape gives the biggest view.
- **Home screen:** Share → **Add to Home Screen** runs it full-screen, like an app.

**To play on your phone,** host the folder on any static host (GitHub Pages, Netlify drop, etc.). You can also run `python3 -m http.server` on your computer and open `http://<your-computer-ip>:8000` on the phone while it's on the same Wi-Fi.

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Start / jump | Space, ↑, W, or click | Tap |
| Higher jump | Hold the jump key | Hold your finger down |
| Fast-fall | ↓ or S | — |
| Pause | P / Esc / ⏸ button | ⏸ button |
| Mute | M / speaker button | Speaker button |
| Restart | Space / Enter / Retry | Tap / Retry |

## Files

```
index.html   markup: canvas, HUD, overlay, buttons
style.css    responsive layout, pixel styling, overlay
game.js      all game logic (one IIFE, ~700 lines, in sections)
tests/e2e.test.js   Playwright tests (node tests/e2e.test.js)
```

## Architecture (game.js)

1. **Config.** All the tuning lives in one `CFG` object: gravity, jump velocity, speed curve, score rate, spawn thresholds.
2. **Sprites.** Each sprite is a list of text rows where one character is one pixel. `makeSprite()` draws it once into a small offscreen canvas and builds a `Uint8Array` collision mask from it. Sprites are drawn at 3× with smoothing turned off, which keeps them crisp at any screen size. The robot's frames are put together from head, body and legs parts (run A/B, jump, dead).
3. **Collision.** There are two phases:
   - A quick bounding-box overlap test.
   - A per-pixel mask check, run only over the area where the boxes overlap.

   Positions are rounded the same way the renderer rounds them, so what you see is what collides. The antenna tip and the drone propellers don't count as hits, which makes near misses a little more forgiving.
4. **Sound.** Every sound is made with the WebAudio API (oscillators and a noise burst), so there are no audio files. Audio starts on the first user gesture because browsers block it until then. The mute setting is saved.
5. **World**
   - **Player.** The jump uses semi-implicit Euler integration. Letting go of jump early cuts the climb short, but only after 80 ms, so even the shortest tap clears a tall crystal. A jump buffer of 120 ms means a press made just before landing still counts. Holding ↓ makes you fall faster.
   - **Obstacles.** Small crystal, tall crystal, and clusters of 2 or 3 crystals. Drones start appearing at score 250:
     - A low drone has to be jumped.
     - A high drone has to be run under.

     Each type is picked with a weight and unlocks at a set score. The gap to the next obstacle is measured in seconds at the current speed, and it is always longer than one jump's airtime, so every pattern can be cleared.
   - **Speed.** It climbs steadily from 380 to 960 px/s. Score depends on distance travelled, so it builds faster as you speed up.
   - **Particles and effects.** Dust on take-off and landing, sparks and screen shake when you crash.
6. **Game flow.** A simple state machine: `ready → running ⇄ paused → over → running`. A 450 ms restart delay stops a panicked key press from skipping the game-over screen. Your best score is saved in `localStorage`, wrapped in try/catch so private browsing doesn't break the game. A "NEW BEST!" badge appears when you beat it.
7. **Input.** Keyboard input plus Pointer Events, so mouse, touch and pen all go through one code path. `touch-action: none` stops scrolling and zooming while you tap. The game pauses itself when the tab is hidden or the window loses focus.
8. **Rendering and loop**
   - **Fixed timestep.** The simulation runs at a fixed 120 Hz using an accumulator inside `requestAnimationFrame`. Physics behave the same on 60 Hz, 120 Hz and 144 Hz screens, and a long frame (for example after switching tabs) is capped at 100 ms.
   - **Parallax layers**, back to front:

     | Layer | Scroll speed |
     |---|---|
     | Stars | 0.02× |
     | Clouds | 0.08× |
     | Mountains | 0.15× |
     | Hills and pines | 0.4× |
     | Ground | 1× |

     The scenery is built from a deterministic hash of each position, so it never pops in or changes.
   - **Day and night.** The sky shifts from day to night as your score rises.
   - **Responsive size.** The world is always 260 px tall, and its width follows the screen's aspect ratio (420 to 1100 px). Phones keep sprites large and simply show a little less of the road ahead. The canvas renders at devicePixelRatio, so it stays sharp on high-resolution screens.

## Tests

`node tests/e2e.test.js` needs Playwright installed. It runs 32 checks:

- Collision unit cases, including transparent pixels that overlap but shouldn't count.
- Jump and gravity, and that a held jump goes higher than a tap.
- Score and speed increase, obstacles spawn, pause works.
- A crash ends the game, the best score is saved, and the restart delay works.
- Mute works, and the best score is still there after a reload.
- A 120-second autoplay bot run that checks the spawns are fair.
- Emulated iPhone 13 in portrait and landscape: tapping starts the game, there's no sideways scrolling, the game fits the screen in landscape, and tapping the mute button doesn't make Bolt jump.

## Tweaking

- **Difficulty:** change the values in `CFG` at the top of `game.js`.
- **New obstacle:** add its pixel art and an entry in `OBSTACLES`.
- **Recolour:** change the colours in `PALETTE`.
