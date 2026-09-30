// Instanced projectiles, oriented along their velocity.
import * as THREE from 'three';
import { MB } from './geo.js';
import { MAT } from './materials.js';

export class ProjectileRenderer {
  constructor(scene, game) {
    this.game = game;
    const G = {};
    let b = new MB();
    b.cyl(0.02, 0.02, 0.45, 0x8a5a33, 0, 0, 0, 5);
    b.cone(0.035, 0.12, 0xdddddd, 0, 0.28, 0, 6);
    b.box(0.12, 0.1, 0.01, 0xff3b6b, 0, -0.18, 0);
    b.box(0.01, 0.1, 0.12, 0xff3b6b, 0, -0.18, 0);
    G.dart = b.build();
    b = new MB();
    b.cyl(0.22, 0.18, 0.08, 0xd9a066, 0, 0, 0, 12);
    b.sphere(0.2, 0xfffdf5, 0, 0.06, 0, 10, 6, 1, 0.45, 1);
    b.sphere(0.06, 0xff3b3b, 0, 0.15, 0, 6, 4);
    G.pie = b.build();
    b = new MB();
    b.cyl(0.3, 0.22, 0.5, (c) => (Math.floor(((Math.atan2(c.z, c.x) + Math.PI) / 6.283) * 10) % 2 ? 0xff3b3b : 0xffffff), 0, 0, 0, 12);
    for (let i = 0; i < 8; i++) b.sphere(0.09, 0xfff3c4, Math.cos(i * 2.4) * 0.16, 0.28, Math.sin(i * 2.4) * 0.16, 5, 4);
    G.popcorn = b.build();
    b = new MB();
    for (let i = 0; i < 6; i++) b.sphere(0.12, i % 2 ? 0xfff3c4 : 0xffe28a, Math.cos(i) * 0.15, Math.sin(i * 1.7) * 0.12, Math.sin(i) * 0.15, 5, 4);
    G.turretpop = b.build();
    b = new MB();
    b.cyl(0.07, 0.07, 0.6, 0xff3b6b, 0, 0, 0, 8);
    b.cone(0.1, 0.22, 0xffd60a, 0, 0.4, 0, 8);
    G.firework = b.build();
    b = new MB();
    b.sphere(0.22, 0x9ee7ff, 0, 0, 0, 8, 6, 1, 1.6, 1);
    G.jet = b.build();
    this.meshes = {};
    for (const [k, geo] of Object.entries(G)) {
      const mat = k === 'jet' ? new THREE.MeshStandardMaterial({ color: 0xbff0ff, transparent: true, opacity: 0.7, roughness: 0.1 }) : k === 'firework' ? MAT.glow : MAT.vc;
      const m = new THREE.InstancedMesh(geo, mat, 300);
      m.frustumCulled = false;
      m.castShadow = k !== 'jet';
      m.count = 0;
      scene.add(m);
      this.meshes[k] = m;
    }
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.dir = new THREE.Vector3();
  }
  update(alpha, dt, effects) {
    const counts = {};
    for (const k in this.meshes) counts[k] = 0;
    for (const p of this.game.projectiles.list) {
      const m = this.meshes[p.type];
      if (!m) continue;
      const i = counts[p.type]++;
      if (i >= 300) continue;
      const x = p.x + p.vx * (alpha - 1) / 60, y = p.y + p.vy * (alpha - 1) / 60, z = p.z + p.vz * (alpha - 1) / 60;
      this.v.set(x, y, z);
      this.dir.set(p.vx, p.vy, p.vz).normalize();
      if (p.type === 'pie' || p.type === 'turretpop' || p.type === 'popcorn') {
        p.spin += dt * 8;
        this.q.setFromAxisAngle(this.dir.set(1, 0.3, 0.2).normalize(), p.spin);
      } else this.q.setFromUnitVectors(this.up, this.dir);
      this.m4.compose(this.v, this.q, this.s);
      m.setMatrixAt(i, this.m4);
      if (effects) {
        if (p.type === 'firework' && Math.random() < 0.8) effects.sparks(x, y, z, 1, 0xffb347, 0.5, 0.35, 0.3, 0);
        if ((p.type === 'popcorn' || p.type === 'turretpop') && Math.random() < 0.15) effects.popcorn.spawn(x, y, z, p.vx * 0.2, 0, p.vz * 0.2, 0xfff3c4, 1, 1.2);
      }
    }
    for (const k in this.meshes) {
      this.meshes[k].count = Math.min(300, counts[k]);
      this.meshes[k].instanceMatrix.needsUpdate = true;
    }
  }
}
