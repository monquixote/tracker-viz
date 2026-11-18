import * as THREE from 'three';
import { Text } from 'troika-three-text';
import type { FrameState, PatternDisplayMode, SongRowInfo } from '../types/timeline.ts';
import { HIGHWAY_TOTAL_WIDTH, LOOKAHEAD_STEPS, STEP_Z_SPACING } from './constants.ts';

const POOL_SIZE = 5;
const PILLAR_HEIGHT = 3.1;
const HEADER_HEIGHT = 0.68;

interface GantryInstance {
  group: THREE.Group;
  leftPillarMat: THREE.MeshBasicMaterial;
  rightPillarMat: THREE.MeshBasicMaterial;
  barMat: THREE.MeshBasicMaterial;
  frameMat: THREE.LineBasicMaterial;
  label: Text;
  lastText: string;
}

export class PatternGantries {
  public readonly group = new THREE.Group();

  private mode: PatternDisplayMode = 'gantries';

  // 1. Gantries
  private gantryGroup = new THREE.Group();
  private gantryPool: GantryInstance[] = [];

  // 2. Fly-Through Laser Title Sting
  private marqueeGroup = new THREE.Group();
  private marqueeLabel!: Text;
  private marqueeShadow!: Text;
  private marqueeLaser!: THREE.Mesh;
  private marqueeLaserMat!: THREE.MeshBasicMaterial;

  // 3. Chromatic Slam + Letter-Spread Dissolve
  private chromaticGroup = new THREE.Group();
  private chromWhite!: Text;
  private chromCyan!: Text;
  private chromMagenta!: Text;

  private lastTitleText = '';
  private lastSongRow = -1;
  private stingAge = 99;

  constructor() {
    this.buildGantries();
    this.buildFlyThroughMarquee();
    this.buildChromaticSlam();

    this.group.add(this.gantryGroup, this.marqueeGroup, this.chromaticGroup);
    this.setDisplayMode('gantries');
  }

  private buildGantries(): void {
    const halfW = HIGHWAY_TOTAL_WIDTH / 2 + 0.14;
    const pillarGeo = new THREE.BoxGeometry(0.12, PILLAR_HEIGHT, 0.12);
    const barGeo = new THREE.BoxGeometry(HIGHWAY_TOTAL_WIDTH + 0.4, HEADER_HEIGHT, 0.14);
    const frameGeo = new THREE.EdgesGeometry(barGeo);

    for (let i = 0; i < POOL_SIZE; i++) {
      const g = new THREE.Group();
      g.visible = false;

      const leftPillarMat = new THREE.MeshBasicMaterial({
        color: '#00f0ff',
        transparent: true,
        opacity: 0.85,
      });
      const leftPillar = new THREE.Mesh(pillarGeo, leftPillarMat);
      leftPillar.position.set(-halfW, PILLAR_HEIGHT / 2, 0);

      const rightPillarMat = new THREE.MeshBasicMaterial({
        color: '#ff2e93',
        transparent: true,
        opacity: 0.85,
      });
      const rightPillar = new THREE.Mesh(pillarGeo, rightPillarMat);
      rightPillar.position.set(halfW, PILLAR_HEIGHT / 2, 0);

      const barMat = new THREE.MeshBasicMaterial({
        color: '#0b101d',
        transparent: true,
        opacity: 0.9,
      });
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(0, PILLAR_HEIGHT + HEADER_HEIGHT / 2 - 0.04, 0);

      const frameMat = new THREE.LineBasicMaterial({
        color: '#00f0ff',
        transparent: true,
        opacity: 0.95,
      });
      const frame = new THREE.LineSegments(frameGeo, frameMat);
      frame.position.copy(bar.position);

      const label = new Text();
      label.fontSize = 0.44;
      label.sdfGlyphSize = 128;
      label.color = '#f8fafc';
      label.anchorX = 'center';
      label.anchorY = 'middle';
      label.maxWidth = HIGHWAY_TOTAL_WIDTH * 0.9;
      label.position.set(0, bar.position.y, 0.09);

      g.add(leftPillar, rightPillar, bar, frame, label);
      this.gantryGroup.add(g);

      this.gantryPool.push({
        group: g,
        leftPillarMat,
        rightPillarMat,
        barMat,
        frameMat,
        label,
        lastText: '',
      });
    }
  }

  private buildFlyThroughMarquee(): void {
    this.marqueeLabel = new Text();
    this.marqueeLabel.fontSize = 2.6;
    this.marqueeLabel.sdfGlyphSize = 128;
    this.marqueeLabel.color = '#f8fafc';
    this.marqueeLabel.outlineWidth = 0.06;
    this.marqueeLabel.outlineColor = '#05070c';
    this.marqueeLabel.anchorX = 'center';
    this.marqueeLabel.anchorY = 'middle';
    this.marqueeLabel.maxWidth = 36;
    this.marqueeLabel.material = new THREE.MeshBasicMaterial({
      transparent: true,
      fog: false,
      depthWrite: false,
    });

    this.marqueeShadow = new Text();
    this.marqueeShadow.fontSize = 2.6;
    this.marqueeShadow.sdfGlyphSize = 128;
    this.marqueeShadow.color = '#00f0ff';
    this.marqueeShadow.anchorX = 'center';
    this.marqueeShadow.anchorY = 'middle';
    this.marqueeShadow.maxWidth = 36;
    this.marqueeShadow.position.set(0.16, -0.14, -0.25);
    this.marqueeShadow.material = new THREE.MeshBasicMaterial({
      transparent: true,
      fog: false,
      depthWrite: false,
    });

    const laserGeo = new THREE.BoxGeometry(0.18, 3.6, 0.25);
    this.marqueeLaserMat = new THREE.MeshBasicMaterial({
      color: '#00f0ff',
      transparent: true,
      opacity: 0,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.marqueeLaser = new THREE.Mesh(laserGeo, this.marqueeLaserMat);

    this.marqueeGroup.add(this.marqueeShadow, this.marqueeLabel, this.marqueeLaser);
    this.marqueeGroup.visible = false;
  }

  private buildChromaticSlam(): void {
    const makeLayer = (color: string, zOffset: number) => {
      const t = new Text();
      t.fontSize = 2.8;
      t.sdfGlyphSize = 128;
      t.color = color;
      t.anchorX = 'center';
      t.anchorY = 'middle';
      t.maxWidth = 42;
      t.position.set(0, 0, zOffset);
      t.material = new THREE.MeshBasicMaterial({
        transparent: true,
        fog: false,
        depthWrite: false,
        blending: zOffset === 0 ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      return t;
    };

    this.chromCyan = makeLayer('#00f0ff', -0.15);
    this.chromMagenta = makeLayer('#ff2e93', -0.1);
    this.chromWhite = makeLayer('#ffffff', 0);
    this.chromWhite.outlineWidth = 0.05;
    this.chromWhite.outlineColor = '#05070c';

    this.chromaticGroup.add(this.chromCyan, this.chromMagenta, this.chromWhite);
    this.chromaticGroup.visible = false;
  }

  public setDisplayMode(mode: PatternDisplayMode): void {
    this.mode = mode;
    this.gantryGroup.visible = mode === 'gantries';
    this.marqueeGroup.visible = mode === 'marquee';
    this.chromaticGroup.visible = mode === 'chromatic';
    if (mode === 'marquee' || mode === 'chromatic') {
      this.lastSongRow = -1;
    }
  }

  private syncStingText(text: string): void {
    if (this.lastTitleText === text) return;
    this.lastTitleText = text;
    this.marqueeLabel.text = text;
    this.marqueeShadow.text = text;
    this.chromWhite.text = text;
    this.chromCyan.text = text;
    this.chromMagenta.text = text;
    this.marqueeLabel.sync();
    this.marqueeShadow.sync();
    this.chromWhite.sync();
    this.chromCyan.sync();
    this.chromMagenta.sync();
  }

  public update(frame: FrameState, songRows: SongRowInfo[], dt = 1 / 60): void {
    if (this.mode === 'none') return;

    if (this.mode === 'marquee' || this.mode === 'chromatic') {
      const row = songRows[frame.songRow];
      const text = row
        ? `${String(row.songRow + 1).padStart(2, '0')} · ${row.patternName.toUpperCase()}`
        : frame.patternName.toUpperCase();

      if (frame.songRow !== this.lastSongRow) {
        this.lastSongRow = frame.songRow;
        this.stingAge = 0;
      }
      this.syncStingText(text);

      if (this.mode === 'marquee') {
        this.updateFlyThrough(frame.isPlaying, dt);
      } else {
        this.updateChromaticSlam(frame.isPlaying, dt);
      }
      return;
    }

    // Gantries
    let used = 0;
    for (let i = 0; i < songRows.length && used < POOL_SIZE; i++) {
      const row = songRows[i]!;
      const deltaSteps = row.startStepFloat - frame.gridStepFloat;
      if (deltaSteps < -0.1 || deltaSteps > LOOKAHEAD_STEPS) continue;

      const z = -deltaSteps * STEP_Z_SPACING;
      const text = `${String(row.songRow + 1).padStart(2, '0')} · ${row.patternName.toUpperCase()}`;
      const passFade = deltaSteps < 2.2 ? Math.max(0, (deltaSteps + 0.1) / 2.3) : 1;

      const g = this.gantryPool[used]!;
      g.group.visible = true;
      g.group.position.set(0, 0, z);
      g.leftPillarMat.opacity = 0.85 * passFade;
      g.rightPillarMat.opacity = 0.85 * passFade;
      g.barMat.opacity = 0.9 * passFade;
      g.frameMat.opacity = 0.95 * passFade;
      g.label.fillOpacity = passFade;
      if (g.lastText !== text) {
        g.label.text = text;
        g.lastText = text;
        g.label.sync();
      }
      used++;
    }

    for (let i = used; i < POOL_SIZE; i++) {
      this.gantryPool[i]!.group.visible = false;
    }
  }

  private updateFlyThrough(isPlaying: boolean, dt: number): void {
    const totalLife = 3.2;
    if (isPlaying) {
      this.stingAge += dt;
    } else if (this.stingAge > 1.5) {
      this.stingAge = 1.0;
    }

    if (this.stingAge >= totalLife) {
      this.marqueeGroup.visible = false;
      return;
    }

    this.marqueeGroup.visible = true;
    const age = this.stingAge;

    let z = -64;
    let y = 8.4;
    let rotX = 0;
    let scale = 1;
    let opacity = 1;

    const sweepHalfW = 16;
    if (age < 0.6) {
      const t = age / 0.6;
      const ease = 1 - Math.pow(1 - t, 3);
      const laserX = -sweepHalfW + ease * (sweepHalfW * 2);
      this.marqueeLabel.clipRect = [-sweepHalfW - 2, -4, laserX, 4];
      this.marqueeShadow.clipRect = [-sweepHalfW - 2, -4, laserX, 4];
      this.marqueeLaser.position.set(laserX, 0, 0.15);
      this.marqueeLaserMat.opacity = Math.sin(t * Math.PI) * 0.95;
      this.marqueeLaserMat.color.set('#00f0ff');

      rotX = -Math.PI * 0.35 * (1 - ease);
      scale = 0.65 + ease * 0.35;
      z = -68 + ease * 4;
      opacity = 0.35 + ease * 0.65;
    } else if (age < 1.85) {
      const t = (age - 0.6) / 1.25;
      this.marqueeLabel.clipRect = null;
      this.marqueeShadow.clipRect = null;
      this.marqueeLaserMat.opacity = 0;

      z = -64 + t * 8;
      y = 8.4 + Math.sin(t * Math.PI) * 0.35;
    } else {
      const t = (age - 1.85) / (totalLife - 1.85);
      const accel = Math.pow(t, 2.0);
      z = -56 + accel * 72;
      y = 8.4 - accel * 2.0;
      scale = 1 + accel * 0.65;
      opacity = t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.35) : 1;

      const laserX = sweepHalfW - t * (sweepHalfW * 2);
      this.marqueeLabel.clipRect = null;
      this.marqueeShadow.clipRect = null;
      this.marqueeLaser.position.set(laserX, 0, 0.15);
      this.marqueeLaserMat.color.set('#ff2e93');
      this.marqueeLaserMat.opacity = (1 - t) * 0.55;
    }

    this.marqueeGroup.position.set(0, y, z);
    this.marqueeGroup.rotation.set(rotX, 0, 0);
    this.marqueeGroup.scale.set(scale, scale, 1);
    this.marqueeLabel.fillOpacity = opacity;
    this.marqueeShadow.fillOpacity = opacity * 0.65;
  }

  private updateChromaticSlam(isPlaying: boolean, dt: number): void {
    const totalLife = 2.6;
    if (isPlaying) {
      this.stingAge += dt;
    } else if (this.stingAge > 1.3) {
      this.stingAge = 0.7;
    }

    if (this.stingAge >= totalLife) {
      this.chromaticGroup.visible = false;
      return;
    }

    this.chromaticGroup.visible = true;
    const age = this.stingAge;

    let z = -58;
    let y = 8.8;
    let scale = 1;
    let split = 0.12;
    let spacing = 0;
    let opacity = 1;

    if (age < 0.35) {
      // Slam forward from vanishing point & snap RGB split together
      const t = age / 0.35;
      const ease = 1 - Math.pow(1 - t, 3);
      z = -90 + ease * 32;
      scale = 0.3 + ease * 0.78 - (t > 0.8 ? (t - 0.8) * 0.4 : 0);
      split = 2.8 * (1 - ease) + 0.12;
      opacity = ease;
    } else if (age < 1.75) {
      // Hold crisp with subtle breathing chromatic fringe
      const t = (age - 0.35) / 1.4;
      scale = 1 + Math.sin(t * Math.PI) * 0.03;
      split = 0.12 + Math.sin(age * 16) * 0.04;
    } else {
      // Dissolve outward with widening letter-spacing & chromatic peel
      const t = (age - 1.75) / (totalLife - 1.75);
      const easeIn = t * t;
      spacing = easeIn * 0.35;
      split = 0.12 + easeIn * 3.2;
      y = 8.8 + easeIn * 1.4;
      scale = 1 + easeIn * 0.2;
      opacity = 1 - t;
    }

    this.chromaticGroup.position.set(0, y, z);
    this.chromaticGroup.scale.set(scale, scale, 1);

    this.chromCyan.position.x = -split;
    this.chromMagenta.position.x = split;
    this.chromWhite.fillOpacity = opacity;
    this.chromCyan.fillOpacity = opacity * 0.85;
    this.chromMagenta.fillOpacity = opacity * 0.85;

    if (Math.abs(this.chromWhite.letterSpacing - spacing) > 0.005) {
      this.chromWhite.letterSpacing = spacing;
      this.chromCyan.letterSpacing = spacing;
      this.chromMagenta.letterSpacing = spacing;
      this.chromWhite.sync();
      this.chromCyan.sync();
      this.chromMagenta.sync();
    }
  }

  public dispose(): void {
    for (const g of this.gantryPool) g.label.dispose();
    this.marqueeLabel.dispose();
    this.marqueeShadow.dispose();
    this.chromWhite.dispose();
    this.chromCyan.dispose();
    this.chromMagenta.dispose();
  }
}
