# Car model contract (Blender → GLB → game)

The hero car is modeled in Blender with a re-runnable Python script, `tools/blender/build_roadster.py`. The script exports `public/models/roadster.glb`. The game loads that file when it exists and uses the procedural car otherwise. The URL parameter `?car=glb|procedural` forces one or the other.

## Design source

- `refs/roadster.png` (rear 3/4 view) is the source of truth.
- Use the side view of the hovering car in `refs/v2-key.jpg` (middle-left frame) for the profile.
- The front is not shown anywhere. Design it in the same language: a sharp low nose and a thin full-width white light bar.
- `refs/hover-thrusters.png` shows a different vehicle. Use it only for the thruster look.

## Geometry

- Units are meters.
- Size: about 4.4 m long, 2.0 m wide and 1.15 m tall. Wheelbase 2.65 m, track about 1.70 m, wheel radius 0.36 m.
- The origin is at ground level (tire contact plane), centered laterally and midway between the axles.
- In Blender the car faces **+Y**. The glTF exporter turns this into **-Z** in three.js.
- Budget: ≤ 80k triangles, ≤ 12 materials, GLB ≤ 5 MB. Do not use Draco compression.

## Node names (the game code depends on them)

- **Wheels**: `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`. Each is a node whose origin is at the hub center, with the spin axis on local X. It holds the tire and the rim.
- **Thruster mount empties**, positioned at the nozzle exits:
  - Firing down: `nozzle_down_FL`, `nozzle_down_FR`, `nozzle_down_RL`, `nozzle_down_RR`, near the wheels on the underside.
  - Firing backward: `nozzle_rear_L`, `nozzle_rear_R`, low at the rear.
  - Firing sideways: `rcs_L_front`, `rcs_L_rear`, `rcs_R_front`, `rcs_R_rear`.
- **Emissive meshes**: `taillight` (the full-width red bar), `headlight` (the front white bar) and `marker_L` / `marker_R` (amber side markers).

## Materials (glTF PBR, by name)

| Name | Look |
| --- | --- |
| `paint` | Warm satin silver-white, about #d9d6d0. Metallic about 0.6, roughness about 0.32, light clearcoat. |
| `lower_black` | Near-black satin. Used on the rocker sweep, the rear fascia and the diffuser. |
| `glass` | Bronze/brown tint, about #2b1d14. Very glossy, no transmission. |
| `tire` | Dark rubber. |
| `rim_dark` | The star spokes. |
| `rim_light` | Light gray aero discs. |
| `tail_red` | Emissive red, strong. |
| `head_white` | Emissive white. |
| `marker_amber` | Emissive amber. |
| `plate` | White plate with `RDSTR` modeled as black geometry. |
