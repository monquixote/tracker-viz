import * as THREE from 'three';
import type { NoteEvent } from '../types/timeline.ts';
import {
  HIGHWAY_TOTAL_WIDTH,
  TRACK_THREE_COLORS,
  type LaneLayout,
} from './constants.ts';

interface VoxelParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  baseScale: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

interface ShockwaveFrame {
  active: boolean;
  x: number;
  baseWidth: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

const MAX_VOXELS = 720;
const MAX_SHOCKWAVES = 48;

export class StrikeZone {
  public readonly group = new THREE.Group();

  private triggerBar: THREE.Mesh;
  private lanePadsGroup = new THREE.Group();
  private lanePadMaterials: THREE.MeshBasicMaterial[] = [];
  private lanePadEnergies: number[] = [];

  private voxels: VoxelParticle[] = [];
  private voxelInstanced: THREE.InstancedMesh;

  private shockwaves: ShockwaveFrame[] = [];
  private shockwaveInstanced: THREE.InstancedMesh;

  private dummy = new THREE.Object3D();
  private tempColor = new THREE.Color();
  private whiteColor = new THREE.Color('#ffffff');

  private createPixelRingTexture(): THREE.CanvasTexture {
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 0, size - 2, 2);
    ctx.fillRect(1, size - 2, size - 2, 2);
    ctx.fillRect(0, 1, 2, size - 2);
    ctx.fillRect(size - 2, 1, 2, size - 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  constructor() {
    // Glowing horizontal strike line at Z = 0
    const barGeo = new THREE.BoxGeometry(HIGHWAY_TOTAL_WIDTH + 0.4, 0.08, 0.16);
    const barMat = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.92,
    });
    this.triggerBar = new THREE.Mesh(barGeo, barMat);
    this.triggerBar.position.set(0, 0.04, 0);
    this.group.add(this.triggerBar);

    this.group.add(this.lanePadsGroup);

    // 1. 3D Tumbling Pixel Voxels (InstancedMesh cubes)
    for (let i = 0; i < MAX_VOXELS; i++) {
      this.voxels.push({
        active: false,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        baseScale: 1,
        life: 0,
        maxLife: 0.5,
        color: new THREE.Color('#ffffff'),
      });
    }

    const voxelGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const voxelMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.voxelInstanced = new THREE.InstancedMesh(voxelGeo, voxelMat, MAX_VOXELS);
    this.voxelInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.voxelInstanced.frustumCulled = false;
    this.group.add(this.voxelInstanced);

    // 2. Expanding Pixel Shockwave Frames
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      this.shockwaves.push({
        active: false,
        x: 0,
        baseWidth: 1,
        life: 0,
        maxLife: 0.28,
        color: new THREE.Color('#ffffff'),
      });
    }

    const waveGeo = new THREE.PlaneGeometry(1, 0.72);
    waveGeo.rotateX(-Math.PI / 2);
    const waveMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: this.createPixelRingTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shockwaveInstanced = new THREE.InstancedMesh(waveGeo, waveMat, MAX_SHOCKWAVES);
    this.shockwaveInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shockwaveInstanced.frustumCulled = false;
    this.group.add(this.shockwaveInstanced);
  }

  public rebuildPads(layout: LaneLayout): void {
    while (this.lanePadsGroup.children.length > 0) {
      const child = this.lanePadsGroup.children.pop()!;
      this.lanePadsGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.lanePadMaterials = [];
    this.lanePadEnergies = new Array<number>(layout.laneCount).fill(0);

    const padGeo = new THREE.BoxGeometry(layout.laneWidth * 0.86, 0.06, 0.52);
    for (let i = 0; i < layout.laneCount; i++) {
      const trkIdx = layout.visibleTrackIndices[i]!;
      const col = TRACK_THREE_COLORS[trkIdx % TRACK_THREE_COLORS.length]!;
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.14,
      });
      const pad = new THREE.Mesh(padGeo.clone(), mat);
      pad.position.set(layout.getLaneX(i), 0.03, 0);
      this.lanePadsGroup.add(pad);
      this.lanePadMaterials.push(mat);
    }
    padGeo.dispose();
  }

  public triggerHits(notes: NoteEvent[], layout: LaneLayout): void {
    for (const note of notes) {
      const laneIdx = layout.trackToLaneIndex.get(note.trackIndex);
      if (laneIdx === undefined) continue;

      this.lanePadEnergies[laneIdx] = 1.0;
      const x = layout.getLaneX(laneIdx);
      const col = TRACK_THREE_COLORS[note.trackIndex % TRACK_THREE_COLORS.length]!;

      this.spawnVoxelBurst(x, layout.laneWidth, col, 22);
      this.spawnShockwave(x, layout.laneWidth, col);
    }
  }

  private spawnVoxelBurst(
    x: number,
    laneWidth: number,
    color: THREE.Color,
    count: number
  ): void {
    let spawned = 0;
    const spreadX = Math.max(0.4, laneWidth * 0.45);
    for (let i = 0; i < MAX_VOXELS && spawned < count; i++) {
      const v = this.voxels[i]!;
      if (v.active) continue;
      v.active = true;
      v.x = x + (Math.random() - 0.5) * spreadX;
      v.y = 0.22 + Math.random() * 0.16;
      v.z = (Math.random() - 0.5) * 0.35;
      v.vx = (Math.random() - 0.5) * 5.2;
      v.vy = 2.8 + Math.random() * 5.4;
      v.vz = (Math.random() - 0.65) * 3.8;
      v.rx = Math.random() * Math.PI;
      v.ry = Math.random() * Math.PI;
      v.rz = Math.random() * Math.PI;
      v.vrx = (Math.random() - 0.5) * 16;
      v.vry = (Math.random() - 0.5) * 16;
      v.baseScale = 0.65 + Math.random() * 0.85;
      v.life = 0;
      v.maxLife = 0.38 + Math.random() * 0.28;
      v.color.copy(color);
      spawned++;
    }
  }

  private spawnShockwave(x: number, laneWidth: number, color: THREE.Color): void {
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const sw = this.shockwaves[i]!;
      if (sw.active) continue;
      sw.active = true;
      sw.x = x;
      sw.baseWidth = laneWidth * 0.9;
      sw.life = 0;
      sw.maxLife = 0.28;
      sw.color.copy(color);
      break;
    }
  }

  public update(dt: number): void {
    // Decay lane pad flashes
    for (let i = 0; i < this.lanePadEnergies.length; i++) {
      const e = Math.max(0, (this.lanePadEnergies[i] ?? 0) - dt * 5.5);
      this.lanePadEnergies[i] = e;
      const mat = this.lanePadMaterials[i];
      if (mat) {
        mat.opacity = 0.14 + e * 0.82;
      }
    }

    // 1. Update 3D tumbling pixel voxels
    let activeVoxels = 0;
    for (let i = 0; i < MAX_VOXELS; i++) {
      const v = this.voxels[i]!;
      if (!v.active) continue;

      v.life += dt;
      if (v.life >= v.maxLife) {
        v.active = false;
        continue;
      }

      v.vy -= 14.5 * dt; // snappy gravity
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      v.z += v.vz * dt;

      // Floor bounce at strike deck
      if (v.y < 0.09 && v.vy < 0) {
        v.y = 0.09;
        v.vy = -v.vy * 0.42;
        v.vx *= 0.78;
        v.vz *= 0.78;
      }

      v.rx += v.vrx * dt;
      v.ry += v.vry * dt;

      const t = v.life / v.maxLife;
      const scale = v.baseScale * Math.pow(1 - t, 0.55);

      this.dummy.position.set(v.x, v.y, v.z);
      this.dummy.rotation.set(v.rx, v.ry, v.rz);
      this.dummy.scale.set(scale, scale, scale);
      this.dummy.updateMatrix();
      this.voxelInstanced.setMatrixAt(activeVoxels, this.dummy.matrix);

      // Start white-hot then cool to saturated lane color
      const whiteMix = Math.max(0, 1 - t * 3.2) * 0.55;
      this.tempColor.copy(v.color).lerp(this.whiteColor, whiteMix);
      this.voxelInstanced.setColorAt(activeVoxels, this.tempColor);
      activeVoxels++;
    }

    this.voxelInstanced.count = activeVoxels;
    this.voxelInstanced.instanceMatrix.needsUpdate = true;
    if (this.voxelInstanced.instanceColor) {
      this.voxelInstanced.instanceColor.needsUpdate = true;
    }

    // 2. Update expanding pixel shockwave frames
    let activeWaves = 0;
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const sw = this.shockwaves[i]!;
      if (!sw.active) continue;

      sw.life += dt;
      if (sw.life >= sw.maxLife) {
        sw.active = false;
        continue;
      }

      const t = sw.life / sw.maxLife;
      const easeOut = 1 - Math.pow(1 - t, 2);
      const scaleW = sw.baseWidth * (0.95 + easeOut * 1.45);
      const scaleZ = 0.95 + easeOut * 1.6;
      const fade = Math.pow(1 - t, 1.5);

      this.dummy.position.set(sw.x, 0.06, 0);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(scaleW, 1, scaleZ);
      this.dummy.updateMatrix();
      this.shockwaveInstanced.setMatrixAt(activeWaves, this.dummy.matrix);

      this.tempColor.copy(sw.color).lerp(this.whiteColor, (1 - t) * 0.35).multiplyScalar(fade);
      this.shockwaveInstanced.setColorAt(activeWaves, this.tempColor);
      activeWaves++;
    }

    this.shockwaveInstanced.count = activeWaves;
    this.shockwaveInstanced.instanceMatrix.needsUpdate = true;
    if (this.shockwaveInstanced.instanceColor) {
      this.shockwaveInstanced.instanceColor.needsUpdate = true;
    }
  }
}
