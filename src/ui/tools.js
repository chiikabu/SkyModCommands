// ─────────────────────────────────────────────────────────────────────────────
//  Player tools: unit brush, building ghosts, path painter, demolish/repair,
//  and the interactive roller-coaster designer.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { h, clear } from './dom.js';
import { UNIT_TYPES, BUILDINGS, TILE, HALF_W, MID, GRID_W, TERR_ROWS, COASTER, PATH_COST } from '../config.js';
import { FACTORIES } from '../render/models.js';
import { MAT } from '../render/materials.js';
import { rotatedSize, entranceTile } from '../sim/park.js';
import { designTrack, stationEntranceTile } from '../sim/coaster.js';
import { generateNodes, repairDesign, stationCandidates } from '../sim/ai/coasterGen.js';
import { inGrid, tileCenterLX, tileCenterLZ } from '../sim/team.js';
import { fmtMoney } from '../util/math.js';
import { RNG } from '../util/rng.js';

export class Tools {
  constructor(app) {
    this.app = app;
    this.tool = null;
    this.rot = 0;
    this.mouse = { x: 0, y: 0, down: false, rdown: null };
    this.ghost = null;
    this.ghostKey = '';
    this.nodeH = 6;
    this.rng = new RNG((Math.random() * 1e9) | 0);
    const view = app.view;
    this.scene = view.scene;
    // unit placement ring
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 6, 28), new THREE.MeshBasicMaterial({ color: 0x5cff8a, toneMapped: false }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.ghostUnit = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 10), new THREE.MeshBasicMaterial({ color: 0x5cff8a, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghostUnit.visible = false;
    this.scene.add(this.ghostUnit);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false }));
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    this.pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false }));
    this.pole.visible = false;
    this.scene.add(this.pole);
    this.nodeMarkers = new THREE.Group();
    this.scene.add(this.nodeMarkers);
    this._bind();
  }
  get game() {
    return this.app.game;
  }
  get hud() {
    return this.app.hud;
  }
  _bind() {
    const c = this.app.view.canvas;
    window.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.onCanvas = e.target === c;
      if (this.mouse.down && this.mouse.onCanvas) this.drag();
    });
    c.addEventListener('pointerdown', (e) => {
      if (!this.game || this.app.hud?.spectator && e.button === 0 && !this.tool) {
        // spectators can still select
      }
      if (e.button === 0) {
        this.mouse.down = true;
        this.lastPaint = null;
        this.click(e);
      } else if (e.button === 2) {
        this.mouse.rdown = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2 && this.mouse.rdown) {
        const moved = Math.hypot(e.clientX - this.mouse.rdown.x, e.clientY - this.mouse.rdown.y);
        this.mouse.rdown = null;
        if (moved < 6) this.rightClick(e);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.game || (e.target && e.target.tagName === 'INPUT')) return;
      if (e.code === 'KeyR' && this.tool && (this.tool === 'build' || this.tool === 'coaster-station')) {
        this.rot = (this.rot + 1) % 4;
        this.app.audio.ui('tick');
      }
      if (this.tool === 'coaster-track') {
        if (e.code === 'KeyZ') this.setNodeH(this.nodeH - 1);
        if (e.code === 'KeyX') this.setNodeH(this.nodeH + 1);
        if (e.code === 'Backspace') {
          this.nodes.pop();
          this.previewDirty = true;
          e.preventDefault();
        }
        if (e.code === 'Enter') this.buildCoaster();
      }
    });
    this.app.view.rig.touchToolActive = () => !!this.tool;
    this.app.view.rig.shiftWheel = (e) => {
      if (this.tool === 'coaster-track') {
        this.setNodeH(this.nodeH - Math.sign(e.deltaY));
        return true;
      }
      return false;
    };
  }

  cancel() {
    const was = this.tool;
    this.tool = null;
    this.unitType = null;
    this.buildType = null;
    this.clearGhost();
    this.ring.visible = false;
    this.ghostUnit.visible = false;
    this.arrow.visible = false;
    this.pole.visible = false;
    this.clearNodes();
    if (this.app.view.coasters) this.app.view.coasters.clearPreview();
    if (this.cpanel) {
      this.cpanel.remove();
      this.cpanel = null;
    }
    this.station = null;
    this.nodes = [];
    if (this.app.view.terrain) {
      this.app.view.terrain.uniforms.uHighlight.value.set(0, 0, 0, 0);
      this.app.view.terrain.uniforms.uGrid.value = 0;
    }
    if (this.hud && this.hud.cursorHint) this.hud.cursorHint.classList.add('hidden');
    if (was && this.hud && !this.hud.spectator) this.hud.renderItems();
  }
  selectUnit(t) {
    if (this.game.phase !== 'prep') {
      this.hud.push('Units can only be deployed during planning.', { kind: 'sys', life: 3000 });
      this.app.audio.ui('error');
      return;
    }
    this.cancel();
    this.tool = 'unit';
    this.unitType = t;
    this.hud.renderItems();
    this.app.audio.ui('click');
  }
  selectBuild(t) {
    this.cancel();
    this.tool = 'build';
    this.buildType = t;
    this.app.view.terrain.uniforms.uGrid.value = 1;
    this.hud.renderItems();
    this.app.audio.ui('click');
  }
  selectPath(remove) {
    this.cancel();
    this.tool = remove ? 'unpath' : 'path';
    this.app.view.terrain.uniforms.uGrid.value = 1;
    this.hud.renderItems();
  }
  selectDemolish() {
    this.cancel();
    this.tool = 'demolish';
    this.hud.renderItems();
  }
  selectRepair() {
    this.cancel();
    this.tool = 'repair';
    this.hud.renderItems();
  }
  startCoaster() {
    this.cancel();
    this.tool = 'coaster-station';
    this.rot = 1;
    this.nodes = [];
    this.app.view.terrain.uniforms.uGrid.value = 1;
    this.buildCoasterPanel();
    this.hud.renderItems();
    this.app.audio.ui('click');
  }

  // ── ghost building ──
  clearGhost() {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostKey = '';
    }
  }
  ensureGhost(type) {
    if (this.ghostKey === type) return;
    this.clearGhost();
    const f = FACTORIES[type];
    let grp;
    if (f) grp = f(0x2f7cf6).group;
    else {
      const d = BUILDINGS[type];
      grp = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w * TILE * 0.8, Math.max(0.5, Math.min(4, d.height)), d.d * TILE * 0.8));
      m.position.y = Math.max(0.5, Math.min(4, d.height)) / 2;
      grp.add(m);
    }
    grp.traverse((o) => {
      if (o.isMesh) {
        o.material = MAT.ghostOk;
        o.castShadow = false;
      }
    });
    this.ghost = grp;
    this.ghostKey = type;
    this.scene.add(grp);
  }
  setGhostOk(ok) {
    if (!this.ghost) return;
    const m = ok ? MAT.ghostOk : MAT.ghostBad;
    this.ghost.traverse((o) => {
      if (o.isMesh) o.material = m;
    });
  }

  ground() {
    return this.app.view.pickGround(this.mouse.x, this.mouse.y);
  }
  // footprint origin tile for a building centred on the cursor (team 0 local = world)
  snap(type, p, rot) {
    const def = BUILDINGS[type];
    const [W, D] = rotatedSize(def, rot);
    const gx = Math.round((p.x + HALF_W) / TILE - W / 2);
    const gz = Math.round((p.z - MID) / TILE - D / 2);
    return { gx, gz, W, D };
  }
  hint(text, bad = false) {
    const el = this.hud.cursorHint;
    if (!text) {
      el.classList.add('hidden');
      return;
    }
    el.textContent = text;
    el.classList.toggle('bad', bad);
    el.classList.remove('hidden');
    el.style.left = this.mouse.x + 'px';
    el.style.top = this.mouse.y + 'px';
  }

  // ── per-frame hover update ──
  update() {
    const g = this.game;
    if (!g || !this.tool) return;
    const tu = this.app.view.terrain.uniforms;
    if (!this.mouse.onCanvas && this.tool !== 'coaster-track') {
      // pointer is over the HUD: hide placement previews
      this.hint(null);
      if (this.ghost && this.tool !== 'coaster-track') this.ghost.visible = false;
      this.ring.visible = false;
      this.ghostUnit.visible = false;
      this.arrow.visible = false;
      tu.uHighlight.value.set(0, 0, 0, 0);
      if (this.tool.startsWith('coaster')) this.updateCoasterPreview();
      return;
    }
    if (this.ghost) this.ghost.visible = true;
    const p = this.ground();
    if (!p) {
      this.hint(null);
      return;
    }
    if (this.tool === 'unit') {
      const d = UNIT_TYPES[this.unitType];
      const chk = g.canDeploy(0, this.unitType, p.x, p.z);
      this.ring.visible = true;
      this.ring.position.set(p.x, p.y + 0.06, p.z);
      this.ring.scale.setScalar(d.scale * (d.vehicle ? 2 : 1));
      this.ring.material.color.set(chk.ok ? 0x5cff8a : 0xff5d5d);
      this.ghostUnit.visible = true;
      this.ghostUnit.position.set(p.x, p.y + 0.8 * d.scale, p.z);
      this.ghostUnit.scale.setScalar(d.scale);
      this.ghostUnit.material.color.set(chk.ok ? 0x5cff8a : 0xff5d5d);
      this.hint(chk.ok ? `${d.icon} ${d.name} · ${fmtMoney(d.cost)}` : chk.reason, !chk.ok);
    } else if (this.tool === 'build' || this.tool === 'coaster-station') {
      const type = this.tool === 'build' ? this.buildType : 'station';
      const s = this.snap(type, p, this.rot);
      const park = g.parks[0];
      let chk;
      if (type === 'station') {
        chk = park.canPlace('station', s.gx, s.gz, this.rot, { noPath: true });
        if (chk.ok) {
          const [ex, ez] = stationEntranceTile(s.gx, s.gz, this.rot);
          if (!inGrid(ex, ez) || ez < 12) chk = { ok: false, reason: 'Station entrance must be in the park' };
        }
      } else chk = park.canPlace(type, s.gx, s.gz, this.rot);
      this.ensureGhost(type);
      this.setGhostOk(chk.ok);
      const cx = -HALF_W + (s.gx + s.W / 2) * TILE, cz = MID + (s.gz + s.D / 2) * TILE;
      this.ghost.position.set(cx, g.world.heightAt(cx, cz), cz);
      this.ghost.rotation.y = Math.PI - this.rot * (Math.PI / 2);
      tu.uHighlight.value.set(-HALF_W + s.gx * TILE, MID + s.gz * TILE, -HALF_W + (s.gx + s.W) * TILE, MID + (s.gz + s.D) * TILE);
      tu.uHighlightOk.value = chk.ok ? 1 : 0;
      const def = BUILDINGS[type];
      if (def.ride || def.shop || type === 'station') {
        const [ex, ez] = type === 'station' ? stationEntranceTile(s.gx, s.gz, this.rot) : entranceTile(s.gx, s.gz, s.W, s.D, this.rot);
        this.arrow.visible = true;
        this.arrow.position.set(tileCenterLX(ex), 1.2 + Math.sin(performance.now() / 200) * 0.2, tileCenterLZ(ez));
        this.arrow.rotation.set(Math.PI, 0, 0);
      } else this.arrow.visible = false;
      if (type === 'station') this.hint(chk.ok ? 'Click to place the station · R to rotate' : chk.reason, !chk.ok);
      else this.hint(chk.ok ? `${def.name} · ${fmtMoney(chk.cost)}${chk.pathTiles && chk.pathTiles.length ? ' (incl. ' + chk.pathTiles.length + ' path)' : ''} · R rotate` : chk.reason, !chk.ok);
    } else if (this.tool === 'path' || this.tool === 'unpath') {
      const gx = Math.floor((p.x + HALF_W) / TILE), gz = Math.floor((p.z - MID) / TILE);
      tu.uHighlight.value.set(-HALF_W + gx * TILE, MID + gz * TILE, -HALF_W + (gx + 1) * TILE, MID + (gz + 1) * TILE);
      const ok = inGrid(gx, gz) && gz >= 12 && (this.tool === 'path' ? g.parks[0].tile(gx, gz) === 0 : g.parks[0].tile(gx, gz) === -1);
      tu.uHighlightOk.value = ok ? 1 : 0;
      this.hint(this.tool === 'path' ? 'Drag to lay path · $' + PATH_COST + '/tile' : 'Drag to remove path');
    } else if (this.tool === 'demolish' || this.tool === 'repair') {
      const b = this.buildingAt(p, 0);
      if (b && b.type !== 'castle' && b.type !== 'gate') {
        const r = b.worldRect(0);
        tu.uHighlight.value.set(r.x0, r.z0, r.x1, r.z1);
        tu.uHighlightOk.value = this.tool === 'repair' ? 1 : 0;
        if (this.tool === 'demolish') this.hint(`Sell ${b.coaster ? 'coaster' : b.def.name} for ${fmtMoney(Math.round((b.coaster ? b.coaster.d.cost : b.def.cost) * 0.5))}`, true);
        else {
          const c = g.parks[0].repairCost(b);
          this.hint(c > 0 ? `Repair for ${fmtMoney(c)}` : 'Not damaged');
        }
      } else {
        tu.uHighlight.value.set(0, 0, 0, 0);
        this.hint(this.tool === 'demolish' ? 'Click a building to sell it' : 'Click a damaged building');
      }
    } else if (this.tool === 'coaster-track') {
      if (this.mouse.onCanvas) {
        this.pole.visible = true;
        const gy = g.world.heightAt(p.x, p.z);
        this.pole.position.set(p.x, gy + this.nodeH / 2, p.z);
        this.pole.scale.set(1, Math.max(0.5, this.nodeH), 1);
        const c = this.candidate;
        if (!c || Math.abs(c.lx - p.x) > 0.3 || Math.abs(c.lz - p.z) > 0.3 || c.h !== this.nodeH) {
          this.candidate = { lx: p.x, lz: p.z, h: this.nodeH };
          this.previewDirty = true;
        }
        this.hint(`Node height ${this.nodeH} m · Shift+Wheel / Z X to change · Click to add · Backspace undo`);
      } else {
        if (this.candidate) {
          this.candidate = null;
          this.previewDirty = true;
        }
        this.pole.visible = false;
        this.hint(null);
      }
    }
    if (this.tool && this.tool.startsWith('coaster')) this.updateCoasterPreview();
  }

  buildingAt(p, team) {
    const g = this.game;
    const s = team === 0 ? 1 : -1;
    const gx = Math.floor((p.x * s + HALF_W) / TILE), gz = Math.floor((p.z * s - MID) / TILE);
    if (!inGrid(gx, gz)) return null;
    const t = g.parks[team].tile(gx, gz);
    if (t > 0) return g.parks[team].byId.get(t);
    return null;
  }

  click(e) {
    const g = this.game;
    if (!g) return;
    const p = this.ground();
    if (!this.tool) {
      // selection
      const u = this.app.view.pickUnit(e.clientX, e.clientY, (u) => !(g.hideTeamUnits === u.team));
      if (u) {
        this.hud.select(u);
        this.app.audio.ui('click');
        return;
      }
      if (p) {
        const b = this.buildingAt(p, 0) || this.buildingAt(p, 1);
        if (b && b.def.cat !== 'scenery') {
          this.hud.select(b);
          this.app.audio.ui('click');
          return;
        }
      }
      this.hud.select(null);
      return;
    }
    if (!p) return;
    if (this.tool === 'unit') this.placeUnit(p);
    else if (this.tool === 'build') {
      const s = this.snap(this.buildType, p, this.rot);
      const chk = g.parks[0].canPlace(this.buildType, s.gx, s.gz, this.rot);
      if (!chk.ok) {
        this.app.audio.ui('error');
        return;
      }
      if (g.teams[0].money < chk.cost) {
        this.hud.push('Not enough money!', { kind: 'bad', life: 2500 });
        this.app.audio.ui('error');
        return;
      }
      const b = g.parks[0].place(this.buildType, s.gx, s.gz, this.rot);
      if (b) this.app.audio.ui('build');
    } else if (this.tool === 'path' || this.tool === 'unpath') this.paint(p);
    else if (this.tool === 'demolish') {
      const b = this.buildingAt(p, 0);
      if (b && g.parks[0].demolish(b)) {
        this.app.audio.ui('demolish');
        if (this.hud.selected === b) this.hud.select(null);
      }
    } else if (this.tool === 'repair') {
      const b = this.buildingAt(p, 0);
      if (b && g.parks[0].repair(b)) this.app.audio.ui('build');
      else this.app.audio.ui('error');
    } else if (this.tool === 'coaster-station') {
      const s = this.snap('station', p, this.rot);
      const chk = g.parks[0].canPlace('station', s.gx, s.gz, this.rot, { noPath: true });
      if (!chk.ok) {
        this.app.audio.ui('error');
        return;
      }
      this.station = { gx: s.gx, gz: s.gz, rot: this.rot, W: s.W, D: s.D };
      this.tool = 'coaster-track';
      this.clearGhost();
      this.arrow.visible = false;
      // keep a ghost of the station
      this.ensureGhost('station');
      this.setGhostOk(true);
      const cx = -HALF_W + (s.gx + s.W / 2) * TILE, cz = MID + (s.gz + s.D / 2) * TILE;
      this.ghost.position.set(cx, 0, cz);
      this.ghost.rotation.y = Math.PI - this.rot * (Math.PI / 2);
      this.app.view.terrain.uniforms.uHighlight.value.set(0, 0, 0, 0);
      this.app.audio.ui('build');
      this.renderCoasterPanel();
    } else if (this.tool === 'coaster-track') {
      if (this.candidate) {
        this.nodes.push({ ...this.candidate });
        this.previewDirty = true;
        this.app.audio.ui('tick');
        this.drawNodes();
      }
    }
  }
  drag() {
    const p = this.ground();
    if (!p) return;
    if (this.tool === 'unit') this.placeUnit(p, true);
    else if (this.tool === 'path' || this.tool === 'unpath') this.paint(p);
    else if (this.tool === 'build' && BUILDINGS[this.buildType].cat === 'scenery') {
      const s = this.snap(this.buildType, p, this.rot);
      if (this.game.parks[0].canPlace(this.buildType, s.gx, s.gz, this.rot).ok && this.game.parks[0].place(this.buildType, s.gx, s.gz, this.rot)) this.app.audio.ui('tick');
    }
  }
  placeUnit(p, dragging = false) {
    const g = this.game;
    const d = UNIT_TYPES[this.unitType];
    const spacing = (d.vehicle ? 3 : 1.3) * d.scale;
    if (dragging && this.lastPaint && Math.hypot(p.x - this.lastPaint.x, p.z - this.lastPaint.z) < spacing) return;
    const chk = g.canDeploy(0, this.unitType, p.x, p.z);
    if (!chk.ok) {
      if (!dragging) {
        this.app.audio.ui('error');
        if (chk.reason === 'Not enough money') this.hud.push('Not enough money!', { kind: 'bad', life: 2000 });
      }
      return;
    }
    const u = g.deploy(0, this.unitType, p.x, p.z);
    if (u) {
      this.lastPaint = { x: p.x, z: p.z };
      this.app.audio.ui('deploy');
    }
  }
  paint(p) {
    const g = this.game;
    const gx = Math.floor((p.x + HALF_W) / TILE), gz = Math.floor((p.z - MID) / TILE);
    const tiles = [];
    if (this.lastPaint) {
      // bresenham between last and current tile
      let x0 = this.lastPaint.gx, z0 = this.lastPaint.gz;
      const dx = Math.abs(gx - x0), dz = Math.abs(gz - z0), sx = x0 < gx ? 1 : -1, sz = z0 < gz ? 1 : -1;
      let err = dx - dz;
      for (let i = 0; i < 200; i++) {
        tiles.push([x0, z0]);
        if (x0 === gx && z0 === gz) break;
        const e2 = 2 * err;
        if (e2 > -dz) { err -= dz; x0 += sx; }
        else { err += dx; z0 += sz; }
      }
    } else tiles.push([gx, gz]);
    let changed = false;
    for (const [x, z] of tiles) {
      if (this.tool === 'path') changed = g.parks[0].placePath(x, z) || changed;
      else changed = g.parks[0].removePath(x, z) || changed;
    }
    if (changed) this.app.audio.ui('tick');
    this.lastPaint = { gx, gz };
  }
  rightClick(e) {
    const g = this.game;
    if (!g) return;
    if (this.tool) {
      this.cancel();
      return;
    }
    // remove own unit during planning
    if (g.phase === 'prep' && !this.hud.spectator) {
      const u = this.app.view.pickUnit(e.clientX, e.clientY, (u) => u.team === 0);
      if (u) {
        g.removeUnit(u);
        this.app.audio.ui('demolish');
        if (this.hud.selected === u) this.hud.select(null);
      }
    }
  }

  // ── Coaster designer ──
  setNodeH(v) {
    this.nodeH = Math.max(1, Math.min(COASTER.maxHeight, Math.round(v)));
    this.previewDirty = true;
    if (this.cHeight) this.cHeight.value = this.nodeH;
    if (this.cHeightLbl) this.cHeightLbl.textContent = this.nodeH + ' m';
  }
  clearNodes() {
    while (this.nodeMarkers.children.length) this.nodeMarkers.remove(this.nodeMarkers.children[0]);
  }
  drawNodes() {
    this.clearNodes();
    const g = this.game;
    for (const n of this.nodes || []) {
      const gy = g.world.heightAt(n.lx, n.lz);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false }));
      s.position.set(n.lx, gy + n.h, n.lz);
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, n.h, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      pl.position.set(n.lx, gy + n.h / 2, n.lz);
      this.nodeMarkers.add(s, pl);
    }
  }
  buildCoasterPanel() {
    this.cpanel = h('div', { class: 'panel cbuilder' });
    this.app.hud.root.appendChild(this.cpanel);
    this.renderCoasterPanel();
  }
  renderCoasterPanel() {
    const el = clear(this.cpanel);
    el.append(h('h4', {}, '🎢 Coaster Designer'));
    if (this.tool === 'coaster-station') {
      el.append(h('div', { class: 'how' }, 'Step 1: place the station (', h('span', { class: 'kbd' }, 'R'), ' rotates). Pick a spot with room around it — low track through your deployment yard flattens invaders!'));
      el.append(h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => this.cancel() }, 'Cancel')));
      return;
    }
    el.append(h('div', { class: 'how' }, 'Step 2: click to lay track nodes — the loop closes itself back to the station. ', h('span', { class: 'kbd' }, 'Shift+Wheel'), ' / ', h('span', { class: 'kbd' }, 'Z'), h('span', { class: 'kbd' }, 'X'), ' height · ', h('span', { class: 'kbd' }, 'Backspace'), ' undo · ', h('span', { class: 'kbd' }, 'Enter'), ' build.'));
    this.cStats = h('div', { class: 'cstats' });
    this.cWarn = h('div', { class: 'cwarn' });
    this.cHeight = h('input', { type: 'range', min: 1, max: COASTER.maxHeight, value: this.nodeH, style: { flex: 1 } });
    this.cHeight.addEventListener('input', () => this.setNodeH(+this.cHeight.value));
    this.cHeightLbl = h('span', { class: 'chip' }, this.nodeH + ' m');
    this.cBuildBtn = h('button', { class: 'btn green', onclick: () => this.buildCoaster() }, 'Build');
    el.append(this.cStats, h('div', { class: 'row' }, h('span', { style: { fontWeight: 900, fontSize: '12px' } }, 'Node height'), this.cHeight, this.cHeightLbl), this.cWarn,
      h('div', { class: 'row end' },
        h('button', { class: 'btn blue', onclick: () => this.autoDesign() }, '✨ Auto-design'),
        h('button', { class: 'btn ghost', onclick: () => { this.nodes = []; this.drawNodes(); this.previewDirty = true; } }, 'Clear'),
        h('button', { class: 'btn ghost', onclick: () => this.cancel() }, 'Cancel'),
        this.cBuildBtn));
    this.previewDirty = true;
  }
  autoDesign() {
    const g = this.game;
    let best = null;
    // try both travel directions through the (symmetric) station footprint
    const rots = [this.station.rot, (this.station.rot + 2) % 4];
    for (let t = 0; t < 40; t++) {
      const st = { ...this.station, rot: rots[t % 2] };
      let nodes = generateNodes(st, this.rng, { defensive: this.rng.chance(0.5), minH: 14, maxH: 28 });
      if (!nodes) continue;
      let d = designTrack(g, 0, st, nodes);
      for (let fix = 0; fix < 2 && !d.valid && /hits/.test(d.reason); fix++) {
        nodes = repairDesign(g, 0, st, nodes, d);
        d = designTrack(g, 0, st, nodes);
      }
      if (!d.valid) continue;
      const score = d.stats.excitement - Math.max(0, d.stats.intensity - 7.6) * 1.4 - Math.max(0, d.cost - g.teams[0].money) / 500;
      if (!best || score > best.score) best = { nodes, score, rot: st.rot };
    }
    if (best) {
      this.station.rot = best.rot;
      if (this.ghost) this.ghost.rotation.y = Math.PI - best.rot * (Math.PI / 2);
      this.nodes = best.nodes;
      this.candidate = null;
      this.designFail = false;
      this.drawNodes();
      this.previewDirty = true;
      this.app.audio.ui('build');
    } else {
      this.designFail = true;
      this.cWarn.textContent = 'No room for a loop here — cancel and place the station somewhere more open.';
      this.app.audio.ui('error');
    }
  }
  updateCoasterPreview() {
    if (!this.previewDirty || this.tool !== 'coaster-track') return;
    const now = performance.now();
    if (this._lastPrev && now - this._lastPrev < 90) return;
    this._lastPrev = now;
    this.previewDirty = false;
    const g = this.game;
    const nodes = [...this.nodes];
    const useCand = this.candidate && this.mouse.onCanvas;
    if (useCand) nodes.push(this.candidate);
    if (nodes.length < 2) {
      this.app.view.coasters.clearPreview();
      if (this.cStats) {
        clear(this.cStats);
        if (!this.designFail) this.cWarn.textContent = 'Add at least 2 nodes (or hit Auto-design).';
      }
      return;
    }
    this.designFail = false;
    const d = designTrack(g, 0, this.station, nodes);
    this.design = d;
    this.app.view.coasters.setPreview(d, 0);
    const st = d.stats;
    const cs = clear(this.cStats);
    const add = (v, l, col) => cs.append(h('div', { class: 'cstat' }, h('div', { class: 'v', style: { color: col || '#fff' } }, v), h('div', { class: 'l' }, l)));
    add(st.excitement.toFixed(1), 'Excitement', '#ffd23f');
    add(st.intensity.toFixed(1), 'Intensity', st.intensity > 8.5 ? '#ff6b6b' : '#ff9f5a');
    add(st.nausea.toFixed(1), 'Nausea', '#8dff8a');
    add(fmtMoney(d.cost), 'Cost', g.teams[0].money >= d.cost ? '#5cff8a' : '#ff8a8a');
    add(Math.round(st.kmh) + ' km/h', 'Top speed');
    add(Math.round(d.L) + ' m', 'Length');
    add(Math.round(st.maxDrop) + ' m', 'Biggest drop');
    add('$' + d.price, 'Ticket');
    this.cWarn.textContent = d.valid ? (st.intensity > 8.6 ? 'Very intense — many guests will be too scared to ride.' : '') : '⚠ ' + d.reason;
    this.cBuildBtn.textContent = 'Build ' + fmtMoney(d.cost);
    this.cBuildBtn.disabled = !d.valid;
  }
  mouseOverCanvas() {
    const el = document.elementFromPoint(this.mouse.x, this.mouse.y);
    return el === this.app.view.canvas;
  }
  buildCoaster() {
    const g = this.game;
    if (!this.station || !this.nodes || this.nodes.length < 2) return;
    const r = g.buildCoaster(0, { gx: this.station.gx, gz: this.station.gz, rot: this.station.rot }, this.nodes);
    if (!r.ok) {
      this.cWarn.textContent = '⚠ ' + r.reason;
      this.app.audio.ui('error');
      return;
    }
    const names = ['Wobble Whip', 'The Big Dipper', 'Screaming Janitor', 'Mop Rocket', 'Loop Troop', 'Thunder Tub', 'Cotton Cyclone', 'Kraken Kart'];
    r.coaster.name = names[(Math.random() * names.length) | 0];
    this.app.audio.ui('build');
    this.cancel();
    this.hud.setTab('coaster');
  }
}
