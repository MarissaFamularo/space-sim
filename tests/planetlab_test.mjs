import assert from 'node:assert/strict';
import { LAB_G, preset, newLab, advanceLab, accelerations, energy, clone, parseLabSave } from '../js/planetlab-physics.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS', name); }
function near(actual, expected, tolerance = 1e-10) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`); }
function run(s, years) { let guard = 0; while (s.time + 1e-10 < years && !s.collision && !s.outcome) { assert.ok(guard++ < 10000, 'simulation must advance'); advanceLab(s, Math.min(.05, years - s.time)); } return s; }
const pair = () => [
  { id:'a', name:'A', mass:1, radius:.001, x:-.5, y:0, vx:0, vy:0 },
  { id:'b', name:'B', mass:.1, radius:.001, x:.5, y:0, vx:0, vy:0 },
];
test('Newton force is mutual and mass-weighted momentum balances', () => {
  const bs = pair(), a = accelerations(bs);
  near(a[0].x, LAB_G * .1); near(a[1].x, -LAB_G);
  near(bs[0].mass*a[0].x + bs[1].mass*a[1].x, 0);
});
test('double attracting mass doubles acceleration', () => {
  const bs=pair(), before=accelerations(bs)[0].x; bs[1].mass *=2;
  near(accelerations(bs)[0].x, before*2);
});
test('double separation quarters acceleration', () => {
  const bs=pair(), before=accelerations(bs)[0].x; bs[1].x=1.5;
  near(accelerations(bs)[0].x, before/4);
});
test('all three presets start in the center-of-mass frame', () => {
  for(const kind of ['moon','binary','comet']) {
    const bs=preset(kind);
    for(const key of ['x','y','vx','vy']) near(bs.reduce((s,b)=>s+b.mass*b[key],0),0);
  }
});
test('default moon earns its badge only after ten years', () => {
  const s=newLab(preset('moon')); run(s,9.99); assert.equal(s.outcome,null);
  run(s,10.01); assert.equal(s.outcome,'kept'); assert.ok(s.time>=10); assert.equal(s.collision,null);
});
test('escape-speed launch does not earn a keeper badge', () => {
  const s=newLab(preset('moon')), m=s.bodies[2], p=s.bodies[1]; m.vy=p.vy+(m.vy-p.vy)*2;
  run(s,.1); assert.equal(s.outcome,'lost'); assert.ok(s.time<.1);
});
test('zero relative moon velocity falls into the planet', () => {
  const s=newLab(preset('moon')), m=s.bodies[2], p=s.bodies[1]; m.vx=p.vx; m.vy=p.vy;
  run(s,.5); assert.ok(s.collision); assert.equal(s.collision.a,'Atlas'); assert.equal(s.collision.b,'Pip');
});
test('overlapping starts stop before integrating and remain finite', () => {
  const bs=pair(); bs[1].x=bs[0].x;
  const s=newLab(bs,'sandbox'); advanceLab(s,.2); assert.ok(s.collision); near(s.time,0);
  for(const b of s.bodies) for(const k of ['x','y','vx','vy']) assert.ok(Number.isFinite(b[k]));
});
test('fast head-on encounter cannot tunnel through a planet', () => {
  const bs=pair(); bs[0].vx=2000; bs[1].vx=-2000;
  const s=newLab(bs,'sandbox'); advanceLab(s,.1); assert.ok(s.collision); assert.ok(s.time<.001);
});
test('binary stars orbit rather than stay fixed', () => {
  const bs=preset('binary'), s=newLab(bs,'binary'); run(s,.04);
  assert.ok(Math.abs(s.bodies[0].y-bs[0].y)>.05);
  assert.ok(Math.abs(s.bodies[1].y-bs[1].y)>.05);
});
test('ten-year binary conserves energy and momentum', () => {
  const s=newLab(preset('binary'),'binary'), e=energy(s.bodies); run(s,10);
  assert.equal(s.collision,null); assert.ok(Math.abs((energy(s.bodies)-e)/e)<1e-5);
  near(s.bodies.reduce((sum,b)=>sum+b.mass*b.vx,0),0,1e-9);
  near(s.bodies.reduce((sum,b)=>sum+b.mass*b.vy,0),0,1e-9);
});
test('moon orbit remains accurate over the entire challenge', () => {
  const s=newLab(preset('moon')), e=energy(s.bodies); run(s,10.01);
  assert.ok(Math.abs((energy(s.bodies)-e)/e)<1e-5);
});
test('comet changes trajectory under a moving planet’s gravity', () => {
  const bs=preset('comet'), full=newLab(bs,'comet'), comparison=newLab(bs.filter(b=>b.id!=='planet'),'comet');
  run(full,.3); run(comparison,.3);
  const a=full.bodies.find(b=>b.id==='comet'), b=comparison.bodies.find(b=>b.id==='comet');
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>.0001);
});
test('snapshot replay is deterministic and does not mutate the launch setup', () => {
  const initial=preset('moon'), original=clone(initial), s=newLab(initial); run(s,.2);
  const rewind=clone(s); advanceLab(s,.03); advanceLab(rewind,.03);
  assert.deepEqual(s,rewind); assert.deepEqual(initial,original);
});
test('halted result cannot advance time or award again', () => {
  const s=newLab(preset('moon')); run(s,10.01); const saved=clone(s);
  advanceLab(s,1); assert.deepEqual(s,saved);
});
test('negative time request cannot reverse the integrator', () => {
  const s=newLab(preset('binary'),'binary'); advanceLab(s,-1); near(s.time,0);
});
test('badge parsing rejects wrong versions and truthy impostors', () => {
  assert.equal(parseLabSave('{oops').moonKeeper,false);
  assert.equal(parseLabSave(null).moonKeeper,false);
  assert.equal(parseLabSave({v:2,moonKeeper:true}).moonKeeper,false);
  assert.equal(parseLabSave({v:1,moonKeeper:'true'}).moonKeeper,false);
  assert.equal(parseLabSave('{"v":1,"moonKeeper":true}').moonKeeper,true);
});
console.log(`\nPlanet Lab: ${passed} passed, 0 failed`);
