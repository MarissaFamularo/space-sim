# Konnie Space Program

**▶ Play it now: https://marissafamularo.github.io/space-sim/**

A KSP-inspired browser space game and coding on-ramp (formerly "Space Sim"). Build a multi-stage rocket, launch it, reach orbit — then fly the **whole solar system**: the Moon, Mars, Saturn's rings, all of it, with real physics, transfer windows, and mid-course corrections. **Exploration Mode** turns satellites, robot probes, a Laser Gauntlet, and colony ships into a persistent science-and-parts progression. Vanilla JS ES modules + Three.js, no build step.

## Run it

```
python3 server.py
```

Then open http://localhost:8011. (A local server is needed because the game uses ES modules; opening `index.html` directly won't work.)

## Planet Lab

The new observatory at the Space Center opens three gravity experiments: **Keep your
moon**, **Two suns**, and **Comet slingshot**. Select a world and change its mass,
starting speed, direction, or position. Run, pause, scrub the replay timeline, or go
back to the start. Changes to the starting controls begin a fresh run. The two open
experiments also support adding and removing worlds (up to eight total).

The lab uses its own moving-body Newtonian simulation. The main mission pauses while
it is open. A ten-year Moon Keeper badge saves separately from rockets, science,
crew, and exploration. World icons are enlarged for visibility; the expandable
physics explanation describes units, collision radii, and model limits.

## License

MIT — see [LICENSE](LICENSE). Bundles [three.js](https://threejs.org) (`vendor/three.module.js` plus post-processing modules in `vendor/postprocessing/` and `vendor/shaders/`), also MIT-licensed, © three.js authors. Planet/sky photos in `vendor/textures/` come from the MIT-licensed [three-globe](https://github.com/vasturiano/three-globe) examples (imagery originally NASA, public domain) — see `vendor/textures/README.md`.

## Docs

- [HANDOFF.md](HANDOFF.md) — current status and pickup point for the next work session (read this first)
- [space-game-design.md](space-game-design.md) — vision and full plan
- [ARCHITECTURE.md](ARCHITECTURE.md) — architecture and frozen data contracts
