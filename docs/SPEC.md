# 飞跃收费站 (RDSTR Toll Jump): spec

A 3D web driving game. The player drives the new Tesla Roadster on a night highway. It uses the "SpaceX package" cold-gas thrusters (shown at the Roadster event on 2026-10-16) to hover, jump traffic and fly over toll plazas. That last part is the internet meme of skipping the toll booth.

Top priorities, in order: **smooth controls with no stutter (steady 60 fps)**, **a realistic night look**, and **a thruster effect that matches the references**.

## References (look at all of them before you build anything)

All files are in `refs/`.

- `roadster.png`: the car design. It is the main reference for the model.
- `hover-thrusters.png`: the thruster look. It has blue-white plume cores and huge white smoke on wet asphalt, plus one plume blowing backward.
- `v1-key.jpg`, `sheet-video1.jpg`: event clip 1. The car climbs a tall curved white ramp with red edge lights and launches to about 66 ft. It comes down with downward thrusters firing and lands inside a massive billowing white cloud tinted pink/red by red ground light strips, then drives off. The HUD has two thin circular gauges: **G-FORCE** at bottom-left (with a car side icon) and **ALTITUDE FT** at bottom-right (with a car top icon).
- `v2-key.jpg`, `sheet-video2.jpg`: event clip 2. The car hovers on 4 downward cyan-white plumes and does a **barrel roll over a Tesla Semi**. The underside shows nozzles at the 4 corners near the wheels, and small side RCS puffs fire during the roll. A drone camera shot shows the car flying over a Semi and a car parked across the road, with bright thruster glare and red barrier lights along the road edge.

## Tech

- Vite, TypeScript (strict) and `three` (latest, WebGLRenderer). No physics engine: the arcade physics is our own code.
- No external model or texture files. Build the car and the world procedurally. Generate textures with canvas at startup.
- Coordinates: meters. Y is up and the car drives toward **-Z**.
- Scripts: `npm run dev`, `npm run build` (runs tsc), `npm test` (vitest).

## The car (procedural, faithful to `roadster.png`)

Size is about 4.4 m long, 2.0 m wide and 1.15 m tall. Wheelbase 2.65 m, wheel radius 0.36 m.

- **Shape**: a low wedge with flat, crisp facets, like the Cybertruck. The long low nose rises in a straight line into one large greenhouse. The canopy peaks at about 55% of the length, then slopes down to a short rear deck. The deck ends in a sharp horizontal "blade" lip that overhangs the rear.
- **Paint**: the upper body is warm satin silver-white (MeshPhysical, light clearcoat). The lower body is black and sweeps up toward the rear. The rear fascia is black with a diffuser that has vertical strakes.
- **Glass**: bronze/brown tint, glossy, reflecting the env map. Do not use the transmission pass.
- **Lights**: a full-width thin **red LED tail bar** under the rear blade, emissive and strong enough to bloom. A thin white front light bar. A small amber side marker behind the front arch.
- **Plate**: a white license plate that reads `RDSTR`.
- **Wheels**: round arches tight to low-profile tires. The rims are a dark 6-spoke star over light-gray aero discs. Wheels spin with speed and the front wheels steer.
- **Underside**: a flat dark floor. Four downward nozzles near the wheels, 2 rear-facing nozzles (for boost), and small side RCS nozzles. Each nozzle ring glows when it fires.

## Thruster FX (the money shot)

- **Plume**: nested additive cone meshes. The inner core is white, the outer sheath cyan-white, with scrolling noise and flicker. The plume length reaches down to the ground (capped). A glare sprite at each nozzle.
- **One PointLight** under the car (cold white). Its intensity follows thrust and it lights the road and the underside.
- **Smoke**: one instanced draw call with about 2,500 particles at most, depth-sorted each frame from preallocated typed arrays. It is cold-gas condensate, white with a slight cyan tint.
  - Where a plume hits the ground, smoke spreads out sideways into big, rolling, lingering clouds. They last 3–6 s, grow from 0.5 m to 5 m, slow down with drag and rise a little. They stay in world space, so they trail behind the moving car.
  - High in the air, the smoke trails downward instead.
  - RCS fires sideways puffs.
- **Rear boost jets** (as important as the downward plumes):
  - Shift fires the 2 rear nozzles: long horizontal cyan-white plumes with a glare at each nozzle, plus a smoke trail that lingers behind the car on the road. This matches the backward plume in `hover-thrusters.png`.
  - The road behind the car lights up, the FOV kicks, the camera shakes slightly, and a boost roar plays.
  - It pushes hard on the road and in the air, and may exceed the normal top speed (about 380 km/h while boosting).
  - Fake the lighting in the shader. Use dim blue ambient, light from the thruster that falls off with distance, and a **red/pink tint on low smoke near the red edge strips**. Fade the particles out near the ground plane, which works like soft particles.
- **Landing burn**: when the car falls fast and gets close to the ground, the thrusters fire automatically and make the giant landing cloud seen in v1. This plays even if the player does nothing.

## World (night, with fog hiding chunk pop-in at about 400 m)

- **Highway**: 4 lanes of 3.75 m plus shoulders. Wet dark asphalt: a canvas noise albedo plus a roughness map with puddles, so the env map and lights glint on it. White dashed and solid lines are instanced.
- **Red LED strips** run along both edge barriers, as in the references. Concrete barriers. Cool-white LED street lamps every 40 m.
- **Lamp light on the road**: draw it as additive radial "light pool" decals on the road, not as real lights. Power poles and wires as in v2. A dark hill silhouette band, a faint city glow on the horizon, and stars.
- **Endless road**: a pool of road chunks that get recycled. Never create or destroy objects at runtime.
- **Env map**: build it once with PMREM from a small dark "night studio" scene (a few emissive panels, red strip, cool softbox), so the paint and glass reflect believably.
- **Traffic**: pooled low-poly sedans with glowing tail lights, moving slower in their lanes. **Tesla Semi** trucks are about 16 m long and 4 m tall: you either fly over them or steer around them.
  - **Keep traffic light**: about half the first version's density, Semis rare, at least one lane always clear at any point, and no traffic within 150 m before a toll plaza or the arena exit.
- **Stunt arena exit (特技场匝道)**: about every 3 km, an exit ramp on the right. Bilingual signs come at 1 km and 500 m. Taking the exit leads to the stunt arena (see the next section). The highway itself has no stunt wall.

## Stunt arena (independent scene, from v1)

See `refs/v1-wall-seq.jpg` (10 frames, read left to right, top row first).

- **A separate scene with no traffic.** The highway exit ramp leads into it through a short fade with the title card "特技场 STUNT ARENA". A curving ramp road takes the car down into the venue.
- **Venue**: a dark open tarmac with long thin red LED lines on the ground, a few cool floodlight towers aimed at the wall, and light haze. A parked Tesla Semi is an optional prop to jump.
- **The wall**: a curved road about 7 m wide. White concrete, a dashed center line, red LED strips on both edges, and a steel truss behind it. It starts flat at ground level and curves up through vertical to about 15° past vertical. The tip is about 20 m (66 ft) up and leans back over the approach.
- **The stunt** (the v1 sequence):
  1. With **suction on** (the car's own system, below), the car drives up the wall with its wheels stuck to the surface. It can stop and hold anywhere, including on the past-vertical part, hanging in the air.
  2. When it drives off the tip, it is **upside down, with its nose pointing up and back**.
  3. The thrusters and RCS automatically **flip the car right side up and turn it around**, taking about 1.2 s. Plumes and puffs fire in several directions, as in frames 7–9.
  4. The car then hovers on its downward plumes (frame 10), and the descent ends in the landing burn and the giant cloud.
  5. The car lands **facing the opposite way** and drives back out the way it came.
- **On the wall**:
  - W climbs.
  - S drives back down.
  - With suction on and no throttle, the car holds position.
  - A/D move sideways.
  - Space detaches the car at any height, which starts the same flip, turn and descent.
- **Leaving**: driving out of the venue gate fades back to the highway at an on-ramp merge. The car faces the highway direction and keeps its speed.
- **Physics while attached**: the state is (s, x, ds/dt), where s is the arc length along the curve and x is the lateral offset. Position and orientation come from the curve.
- **Without suction**, the car stays on the wall only while it is fast enough (centripetal force must beat the gravity component pulling it off). When it slows, it falls off. The HUD warns "吸附未开启 / SUCTION OFF".
- **Warm up** the arena's shaders at startup together with everything else, so the transition never stutters.

## Suction (吸附): the car's system, not the wall's

- It is an underbody fan system on the car, toggled with F.
- The HUD always shows its state next to the G-FORCE gauge, with a downforce readout in kN when it is on.
- **On the road**: more grip (sharper steering at speed, less slide), the car squats a few cm, a turbine whine plays, and small dust particles are pulled in at the side skirts.
- **On the wall**: it is what lets the car climb slowly, stop, and hang past vertical.
- **In the air**: it does nothing, because there is no surface.

## Toll plaza (the meme)

The first plaza comes at about 800 m, then one every 2 km.

- **Approach signs**: "前方收费站 500m" and "ETC". The road widens to 8 lanes over a taper and narrows again afterward.
- **Plaza layout**:
  - A large canopy: underside at 6 m, top at 7 m, 20 m deep.
  - A glowing fascia sign: `火星高速 · 星舰收费站`.
  - Green/red lane signals over each lane, and purple ETC signs.
  - Booth islands with lit booth cabins.
  - A red-and-white striped **boom barrier** across every lane. About half the lanes are **ETC lanes** (purple ETC sign, green signal), and their booms open automatically. The rest are manual lanes, and their booms stay down.
  - **Wide enough to drive through at speed**: each lane opening is at least 5.5 m wide (so use fewer lanes, for example 6) and the islands are about 1.2 m wide. The hitboxes of booths and islands are slightly smaller than their visuals.
  - A price board: `小型车 ¥45`.
- **Outcomes**, decided in `src/sim/toll.ts`:
  - Fly **over the canopy roof** (y above about 7.5 m while over the canopy): "飞跃收费站！省下 ¥45". This is the big bonus.
  - Clear the boom in the air (above it at the boom line): "跳过收费杆！逃费 ¥45".
  - Drive through an **ETC lane** on the ground at any speed: the boom lifts just before the car arrives, with a 嘀 chime and "ETC 扣费 ¥45 / ETC: ¥45 paid". There is no bonus and no penalty. This is the normal, legal way through.
  - Hit a **manual-lane** boom on the ground: "冲卡！罚款 ¥200". The boom snaps off with debris, the car slows down and the screen shakes. The player loses no life.
  - Hit a booth or the canopy: a crash. Grazing an island curb only deflects the car, with a small speed loss.
- The toll price grows a bit at each plaza. Keep a running total: "累计逃费 ¥X".

## Controls (must feel instant and smooth)

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake |
| A D / ← → | Steer (smoothed toward the target; the response depends on speed) |
| Space (hold) | Thrusters: lift and hover. Drains COPV gas, which refills on the ground. On the suction wall, Space detaches the car instead. |
| S (in the air, thrusters on) | Brake forward speed, so the car can hover in place like the v2 stage hover |
| F | Suction (吸附) on/off. This is the car's own system (see "Suction" above). |
| L | Cycle the language: 中文 → English → 日本語 |
| Shift | Rear boost jets: a strong forward push, on the road and in the air. Drains gas. |
| Q / E | Barrel roll while airborne. A roll finishes on its own in about 0.8 s, and landing mid-roll is a crash. |
| C | Camera: chase / side cinematic / **drone aerial** (like v2) |
| Esc | Pause |
| M | Mute |
| R | Restart |

- Touch buttons for mobile: steer, thrust, boost and roll.
- Call `preventDefault` on game keys and clear all keys on window blur.
- Physics is arcade-style:
  - Gravity is about 1.6 g.
  - Thrust gives about 2.2 g of lift, tapering off above 25 m.
  - Top speed is about 320 km/h, and 0–100 km/h takes about 2.2 s.
  - The car pitches and rolls with velocity and steering.
  - The car stays inside the road bounds and bounces off the barriers.
- **Collisions** are AABB checks against traffic, Semis, booths, pillars and the ramp frame. A crash cuts speed sharply, adds shake and sparks, and costs a life (3 lives). The player then blinks invulnerable for 2 s.
- **Score**:
  - +1 per meter of distance.
  - Air time: +100/s.
  - Each roll: +500.
  - A near miss within 1 m at speed: "擦肩 +100".
  - Toll skips, as above.
  - The best score is saved to localStorage, wrapped in try/catch.

## Camera and post

- **Chase camera**: a frame-rate-independent spring (`1 - exp(-k*dt)`). FOV goes from 60 to 75 with speed, with a kick on boost. Slight roll into turns. When airborne, the camera pulls back to frame the smoke.
- **Shake**: a trauma-based model with noise.
- **Post-processing**: an EffectComposer with a 4× MSAA target.
  - RenderPass.
  - UnrealBloomPass at half resolution.
  - One custom final pass: vignette, fine grain, and subtle chromatic aberration that grows with speed.
  - OutputPass with ACES tone mapping.

## UI (DOM over the canvas, minimalist Tesla-live style)

- **Bottom-left**: the G-FORCE ring gauge with a car side icon that tilts with the car's pitch and roll.
- **Bottom-right**: the ALTITUDE FT ring gauge with a car top icon.
- **Bottom-center**: a big speed readout in km/h and a COPV gas bar.
- **Top bar**: score, lives and 累计逃费.
- **Center popups**: short, punchy text that animates in and out.
- Use thin white type with tabular numbers. Draw the rings as SVG. Update the HUD at no more than 30 Hz and only when a shown value changes.
- **Languages: Chinese, English and Japanese.**
  - All UI text (HUD labels, popups, screens, the controls list and hints) comes from one dictionary, `src/ui/i18n.ts`, with a zh and an en entry for every key. A test checks that both languages have every key.
  - The default comes from `navigator.language`. L, or a 中文 · EN · 日本語 button on the start screen, cycles it. The choice is saved in localStorage, wrapped in try/catch.
  - In-world signs carry both languages on the texture, like real Chinese expressway signs: one Chinese line and one English line, for example `火星高速 · 星舰收费站` over `MARS EXPRESSWAY · STARSHIP TOLL STATION`.
  - The README gets an English section.
- **Start screen**: a homage to `roadster.png`. A dark studio with a soft spotlight pool on the floor, the car slowly turning, title **飞跃收费站**, subtitle "RDSTR · SpaceX 冷气推进套件", a list of the controls, and "按 Enter / 点击 开始".
- **Pause screen** and **game-over screen**: show distance, tolls skipped, ¥ saved and the best score, with a restart button.
- **Procedural WebAudio**, started on the first user gesture:
  - Motor whine whose pitch follows speed.
  - Thruster roar made from filtered noise, with volume following thrust.
  - Wind.
  - A crash thump.
  - An ETC "嘀" chime when you skip a toll.

## Performance rules (non-negotiable: the user said 不能卡)

- Use `renderer.setAnimationLoop`.
- The physics step is clamped (dt ≤ 1/30). All motion and smoothing is frame-rate independent.
- **No allocations in the frame loop.** Use module-scope scratch vectors and pools for everything.
- Use InstancedMesh or merged geometry for repeated objects. Keep draw calls under 200.
- Pixel ratio defaults to `min(dpr, 1.5)` and adapts: drop it when the average frame time is over 18.5 ms (floor 0.75) and raise it again when frames are fast. Support `?quality=low|high`.
- **Warm up shaders before play.** Call `renderer.compile`, and render the plaza, the ramp, and the plume and smoke materials once at the start screen, so nothing compiles mid-run.
- Cast real-time shadows only from a moon light that follows the car with a small frustum. Under the car, use a blob shadow decal that shrinks and fades with altitude, since that is an important altitude cue.
- Add a `?debug` overlay with fps, frame time, draw calls and triangles.
- Expose `window.__game` for scripted checks: a `state` snapshot, plus `debug.teleport(z)`, `debug.setSpeed(kmh)`, `debug.thrust(on)`, `debug.pause()` and `debug.camera(mode)`.

## Code layout (suggested)

- `src/main.ts`
- `src/config.ts` (all tunables)
- `src/sim/`: pure logic with no three.js imports, unit tested.
  - `vehicle.ts`: the step function covering drive, steer, gravity, thrust, gas, roll and bounds.
  - `toll.ts`: classifies a toll pass.
  - `suction.ts`: the car's suction system (toggle, downforce, grip).
  - `wall.ts`: driving on the arena's curved wall. Covers staying attached (through suction or speed), holding position, the tip launch, and the flip that reverses the heading.
  - `collision.ts`
  - `score.ts`
- `src/render/`
  - `roadster.ts`
  - `thrusters.ts`
  - `smoke.ts`
  - `road.ts`
  - `tollPlaza.ts`
  - `traffic.ts`
  - `ramp.ts`
  - `environment.ts`
  - `post.ts`
  - `camera.ts`
- `src/ui/`
  - `hud.ts`
  - `screens.ts`
  - `audio.ts`
  - `input.ts`

## Done means

1. `npm run build` and `npm test` pass. `src/sim/*` has tests for the thrust/gravity/gas step, the toll outcomes, collision and scoring.
2. Screenshots from Playwright Chromium, saved in `shots/`:
   - The start screen.
   - Normal driving.
   - Hovering with plumes and ground smoke.
   - The highway exit sign and the exit ramp.
   - An overview of the arena.
   - The car held high on the wall with suction on.
   - The car upside down at the tip.
   - The mid-air flip with RCS puffs.
   - The hover descent.
   - The landing cloud, with the car facing the reverse direction.
   - The start screen and the HUD in English.
   - The toll plaza approach.
   - Flying over the plaza canopy.
   - The drone cam.
   Compare each one to `refs/` and polish until it is close. Do at least 2 visual polish passes.
3. A measured fps and frame-time report: the method, the browser, and avg and p95 frame time while driving and while hovering in thick smoke.
4. A Chinese `README.md` with how to run, the controls and the features.
