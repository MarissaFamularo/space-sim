# Space Sim

**▶ Play it now: https://marissafamularo.github.io/space-sim/**

A KSP-inspired browser space game and coding on-ramp. Build a multi-stage rocket, launch it, reach orbit — then fly the **whole solar system**: the Moon, Mars, Saturn's rings, all of it, with real physics, transfer windows, and mid-course corrections. Vanilla JS ES modules + Three.js, no build step.

## Run it

```
python3 server.py
```

Then open http://localhost:8000. (A local server is needed because the game uses ES modules; opening `index.html` directly won't work.)

## License

MIT — see [LICENSE](LICENSE). Bundles [three.js](https://threejs.org) (`vendor/three.module.js` plus post-processing modules in `vendor/postprocessing/` and `vendor/shaders/`), also MIT-licensed, © three.js authors. Planet/sky photos in `vendor/textures/` come from the MIT-licensed [three-globe](https://github.com/vasturiano/three-globe) examples (imagery originally NASA, public domain) — see `vendor/textures/README.md`.

## Docs

- [HANDOFF.md](HANDOFF.md) — current status and pickup point for the next work session (read this first)
- [space-game-design.md](space-game-design.md) — vision and full plan
- [ARCHITECTURE.md](ARCHITECTURE.md) — architecture and frozen data contracts
