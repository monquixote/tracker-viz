import * as THREE from 'three';
import type { AudioAnalysisFrame } from '../audio/audioAnalyzer.ts';
import {
  HIGHWAY_TOTAL_WIDTH,
  LOOKAHEAD_STEPS,
  PAST_STEPS,
  STEP_Z_SPACING,
  TRACK_THREE_COLORS,
  type LaneLayout,
} from './constants.ts';

const NEAR_Z_CAP = 1.35; // Terminate road right under the track name tabs

export class LaneGrid {
  public readonly group = new THREE.Group();

  private deckMesh: THREE.Mesh;
  private endCapBar: THREE.Mesh;
  private railGroup = new THREE.Group();
  private railMeshes: THREE.Mesh[] = [];
  private outerRailMeshes: THREE.Mesh[] = [];
  private sideGlowMeshes: THREE.Mesh[] = [];
  private laneFloorGroup = new THREE.Group();
  private laneFloorMeshes: THREE.Mesh[] = [];
  private laneTrackIndices: number[] = [];

  private stepLineInstanced: THREE.InstancedMesh;
  private maxStepLines = LOOKAHEAD_STEPS + PAST_STEPS + 4;
  private dummy = new THREE.Object3D();
  private stepColorNormal = new THREE.Color('#19202e');
  private stepColorBeat = new THREE.Color('#2d3748');
  private stepColorBar = new THREE.Color('#475569');

  constructor() {
    // Unit-length (1.0) Z geometries so we can dynamically scale between farZ and nearZ
    const deckGeo = new THREE.PlaneGeometry(HIGHWAY_TOTAL_WIDTH + 0.6, 1);
    const deckMat = new THREE.MeshBasicMaterial({
      color: '#090c12',
      transparent: true,
      opacity: 0.96,
    });
    this.deckMesh = new THREE.Mesh(deckGeo, deckMat);
    this.deckMesh.rotation.x = -Math.PI / 2;
    this.group.add(this.deckMesh);

    const endCapGeo = new THREE.BoxGeometry(HIGHWAY_TOTAL_WIDTH + 0.1, 0.04, 0.12);
    const endCapMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
    this.endCapBar = new THREE.Mesh(endCapGeo, endCapMat);
    this.endCapBar.visible = false;
    this.group.add(this.endCapBar);

    this.group.add(this.laneFloorGroup);
    this.group.add(this.railGroup);

    // Instanced horizontal step/beat/bar divider lines
    const lineGeo = new THREE.BoxGeometry(HIGHWAY_TOTAL_WIDTH, 0.015, 0.045);
    const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.stepLineInstanced = new THREE.InstancedMesh(lineGeo, lineMat, this.maxStepLines);
    this.stepLineInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.stepLineInstanced);
  }

  public setTransparentBackground(transparent: boolean): void {
    const mat = this.deckMesh.material as THREE.MeshBasicMaterial;
    mat.opacity = transparent ? 0.45 : 0.96;
  }

  private createSideGlowTexture(): THREE.CanvasTexture {
    const w = 64;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    // Bright at left edge (x=0), smooth exponential falloff to 0 at right edge (x=w)
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.55)');
    grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.14)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  public rebuildLanes(layout: LaneLayout): void {
    // Clear old rails & lane floors
    while (this.railGroup.children.length > 0) {
      const child = this.railGroup.children.pop()!;
      this.railGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    while (this.laneFloorGroup.children.length > 0) {
      const child = this.laneFloorGroup.children.pop()!;
      this.laneFloorGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.railMeshes = [];
    this.outerRailMeshes = [];
    this.sideGlowMeshes = [];
    this.laneFloorMeshes = [];
    this.laneTrackIndices = [];

    // Lane dividers (count + 1 rails, unit Z length = 1)
    const railGeo = new THREE.BoxGeometry(0.035, 0.03, 1);
    const outerRailGeo = new THREE.BoxGeometry(0.09, 0.07, 1);
    const sideGlowGeo = new THREE.PlaneGeometry(1, 1);
    sideGlowGeo.rotateX(-Math.PI / 2);
    const sideGlowTex = this.createSideGlowTexture();

    for (let i = 0; i <= layout.laneCount; i++) {
      const isOuter = i === 0 || i === layout.laneCount;
      const isLeft = i === 0;
      const railMat = new THREE.MeshBasicMaterial({
        color: isOuter ? (isLeft ? '#00f0ff' : '#ff2e93') : '#1e293b',
        transparent: true,
        opacity: isOuter ? 0.9 : 0.85,
      });
      const rail = new THREE.Mesh(
        (isOuter ? outerRailGeo : railGeo).clone(),
        railMat
      );
      const x = -HIGHWAY_TOTAL_WIDTH / 2 + i * layout.laneWidth;
      rail.position.set(x, isOuter ? 0.025 : 0.005, 0);
      this.railGroup.add(rail);
      this.railMeshes.push(rail);

      if (isOuter) {
        this.outerRailMeshes.push(rail);
        // Wide soft-falloff floor light beam radiating outward from the rail (above deckMesh)
        const glowMat = new THREE.MeshBasicMaterial({
          color: isLeft ? '#00f0ff' : '#ff2e93',
          map: sideGlowTex,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Mesh(sideGlowGeo.clone(), glowMat);
        if (isLeft) {
          // Rotate around Y by 180 deg so bright edge touches left rail and fades outward (-X)
          glow.rotation.y = Math.PI;
        }
        glow.position.set(x, 0.004, 0);
        this.railGroup.add(glow);
        this.sideGlowMeshes.push(glow);
      }
    }
    railGeo.dispose();
    outerRailGeo.dispose();
    sideGlowGeo.dispose();

    // Per-lane subtle tinted floor strip (unit Z length = 1)
    const stripGeo = new THREE.PlaneGeometry(layout.laneWidth * 0.92, 1);
    for (let i = 0; i < layout.laneCount; i++) {
      const trkIdx = layout.visibleTrackIndices[i]!;
      const col = TRACK_THREE_COLORS[trkIdx % TRACK_THREE_COLORS.length]!;
      const stripMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.015,
        depthWrite: false,
      });
      const strip = new THREE.Mesh(stripGeo.clone(), stripMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(layout.getLaneX(i), -0.01, 0);
      this.laneFloorGroup.add(strip);
      this.laneFloorMeshes.push(strip);
      this.laneTrackIndices.push(trkIdx);
    }
    stripGeo.dispose();
  }

  public update(
    gridStepFloat: number,
    activeMutes: boolean[],
    totalSteps: number,
    analysis: AudioAnalysisFrame | null = null
  ): void {
    // Compute visible road span: starts under track names (NEAR_Z_CAP) and ends at song end
    const remainingSteps = Math.max(0, totalSteps - gridStepFloat);
    const farSteps = Math.min(LOOKAHEAD_STEPS, remainingSteps);
    const farZ = -farSteps * STEP_Z_SPACING;
    const roadLen = Math.max(0.05, NEAR_Z_CAP - farZ);
    const roadCenterZ = (NEAR_Z_CAP + farZ) / 2;

    this.deckMesh.scale.set(1, roadLen, 1);
    this.deckMesh.position.set(0, -0.02, roadCenterZ);

    for (const rail of this.railMeshes) {
      rail.scale.set(1, 1, roadLen);
      rail.position.z = roadCenterZ;
    }

    const leftEnergy = analysis
      ? Math.min(1, Math.pow(analysis.bass * 1.7 + analysis.rms * 0.45, 0.8))
      : 0;
    const rightEnergy = analysis
      ? Math.min(1, Math.pow((analysis.mid * 1.6 + analysis.high * 2.0 + analysis.rms * 0.7), 0.8))
      : 0;

    const halfW = HIGHWAY_TOTAL_WIDTH / 2;

    if (this.outerRailMeshes[0]) {
      const m = this.outerRailMeshes[0].material as THREE.MeshBasicMaterial;
      m.opacity = 0.45 + leftEnergy * 0.55;
      this.outerRailMeshes[0].scale.set(1 + leftEnergy * 0.8, 1 + leftEnergy * 1.2, roadLen);
    }
    if (this.outerRailMeshes[1]) {
      const m = this.outerRailMeshes[1].material as THREE.MeshBasicMaterial;
      m.opacity = 0.45 + rightEnergy * 0.55;
      this.outerRailMeshes[1].scale.set(1 + rightEnergy * 0.8, 1 + rightEnergy * 1.2, roadLen);
    }
    if (this.sideGlowMeshes[0]) {
      const w = 1.0 + leftEnergy * 3.8;
      this.sideGlowMeshes[0].scale.set(w, 1, roadLen);
      this.sideGlowMeshes[0].position.set(-halfW - w / 2, 0.004, roadCenterZ);
      (this.sideGlowMeshes[0].material as THREE.MeshBasicMaterial).opacity = 0.14 + leftEnergy * 0.82;
    }
    if (this.sideGlowMeshes[1]) {
      const w = 1.0 + rightEnergy * 3.8;
      this.sideGlowMeshes[1].scale.set(w, 1, roadLen);
      this.sideGlowMeshes[1].position.set(halfW + w / 2, 0.004, roadCenterZ);
      (this.sideGlowMeshes[1].material as THREE.MeshBasicMaterial).opacity = 0.14 + rightEnergy * 0.82;
    }

    for (const strip of this.laneFloorMeshes) {
      strip.scale.set(1, roadLen, 1);
      strip.position.z = roadCenterZ;
    }

    // Show crisp end-of-song cap bar when the end of the track enters view
    if (remainingSteps <= LOOKAHEAD_STEPS) {
      this.endCapBar.visible = true;
      this.endCapBar.position.set(0, 0.01, farZ);
    } else {
      this.endCapBar.visible = false;
    }

    // Update scrolling horizontal step lines (clamped between farZ and NEAR_Z_CAP)
    const firstStep = Math.max(0, Math.floor(gridStepFloat - 1));
    let instanceIdx = 0;

    for (let i = 0; i < this.maxStepLines; i++) {
      const stepNum = firstStep + i;
      if (stepNum > totalSteps) break;

      const deltaSteps = stepNum - gridStepFloat;
      const z = -deltaSteps * STEP_Z_SPACING;
      if (z > NEAR_Z_CAP || z < farZ) continue;

      const isBar = stepNum % 16 === 0;
      const isBeat = stepNum % 4 === 0;

      this.dummy.position.set(0, 0.0, z);
      this.dummy.scale.set(1, isBar ? 1.8 : isBeat ? 1.2 : 0.7, isBar ? 2.0 : isBeat ? 1.3 : 0.7);
      this.dummy.updateMatrix();

      this.stepLineInstanced.setMatrixAt(instanceIdx, this.dummy.matrix);
      this.stepLineInstanced.setColorAt(
        instanceIdx,
        isBar ? this.stepColorBar : isBeat ? this.stepColorBeat : this.stepColorNormal
      );
      instanceIdx++;
    }

    this.stepLineInstanced.count = instanceIdx;
    this.stepLineInstanced.instanceMatrix.needsUpdate = true;
    if (this.stepLineInstanced.instanceColor) {
      this.stepLineInstanced.instanceColor.needsUpdate = true;
    }

    // Update mute dimming on lane floors
    for (let i = 0; i < this.laneFloorMeshes.length; i++) {
      const trkIdx = this.laneTrackIndices[i]!;
      const isMuted = activeMutes[trkIdx] ?? false;
      const mat = this.laneFloorMeshes[i]!.material as THREE.MeshBasicMaterial;
      mat.opacity = isMuted ? 0.002 : 0.015;
    }
  }
}
