import * as THREE from 'three';
import { Text } from 'troika-three-text';
import pixelFontUrl from '@fontsource/silkscreen/files/silkscreen-latin-700-normal.woff?url';
import type { FrameState, TrackMeta } from '../types/timeline.ts';

const resolvedPixelFontUrl =
  typeof window !== 'undefined'
    ? new URL(pixelFontUrl, window.location.href).href
    : pixelFontUrl;
import {
  STEP_Z_SPACING,
  TRACK_HEX_PALETTE,
  TRACK_THREE_COLORS,
  type LaneLayout,
} from './constants.ts';

const MAX_NOTE_INSTANCES = 1024;
const LABEL_POOL_SIZE = 80;

const TRACK_TEXT_COLORS = TRACK_THREE_COLORS.map((c) =>
  c.clone().lerp(new THREE.Color('#ffffff'), 0.25).multiplyScalar(1.35)
);
const TRIGGER_TEXT_COLOR = new THREE.Color('#ffffff').multiplyScalar(1.45);
const OFF_TEXT_COLOR = new THREE.Color('#94a3b8');

interface PooledCellLabel {
  noteMesh: Text;
  lastNoteText: string;
  lastColorKey: string;
}

export class NoteHighway {
  public readonly group = new THREE.Group();

  private cellInstanced: THREE.InstancedMesh;
  private labelPool: PooledCellLabel[] = [];
  private headerGroup = new THREE.Group();

  private dummy = new THREE.Object3D();
  private tempColor = new THREE.Color();
  private cellTriggerColor = new THREE.Color('#22c55e');
  private offCellColor = new THREE.Color('#475569');

  private createPixelBlockTexture(): THREE.CanvasTexture {
    // 24x24 pixel-art box face: deep near-black interior (#10141f) + pure white border (#ffffff)
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#10141f';
    ctx.fillRect(0, 0, size, size);

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
    // Unified 3D extruded pixel-retro brick (no white emissive washout so instanceColor stays 100% saturated)
    const blockTex = this.createPixelBlockTexture();
    const cellGeo = new THREE.BoxGeometry(1, 1, 1);
    const cellMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: blockTex,
      roughness: 0.38,
      metalness: 0.18,
    });
    this.cellInstanced = new THREE.InstancedMesh(cellGeo, cellMat, MAX_NOTE_INSTANCES);
    this.cellInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.cellInstanced);

    // Pooled troika-three-text labels (high-res SDF, clean centered pixel-retro Note text)
    for (let i = 0; i < LABEL_POOL_SIZE; i++) {
      const noteMesh = new Text();
      noteMesh.font = resolvedPixelFontUrl;
      noteMesh.fontSize = 0.44;
      noteMesh.sdfGlyphSize = 128;
      noteMesh.anchorX = 'center';
      noteMesh.anchorY = 'middle';
      noteMesh.rotation.x = -Math.PI / 2;
      noteMesh.visible = false;
      this.group.add(noteMesh);

      this.labelPool.push({
        noteMesh,
        lastNoteText: '',
        lastColorKey: '',
      });
    }

    this.group.add(this.headerGroup);
  }

  public rebuildHeaders(layout: LaneLayout, tracks: TrackMeta[]): void {
    while (this.headerGroup.children.length > 0) {
      const child = this.headerGroup.children.pop()!;
      this.headerGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          (child.material as THREE.Material)?.dispose();
        }
      }
    }

    const fontSize = Math.min(0.21, layout.laneWidth * 0.125);
    const maxNameChars = layout.laneCount > 10 ? 7 : 10;
    const pillGeo = new THREE.PlaneGeometry(layout.laneWidth * 0.88, 0.56);

    for (let i = 0; i < layout.laneCount; i++) {
      const trkIdx = layout.visibleTrackIndices[i]!;
      const meta = tracks[trkIdx];
      const x = layout.getLaneX(i);

      const pillMat = new THREE.MeshBasicMaterial({
        color: '#2d333f',
        transparent: true,
        opacity: 0.92,
      });
      const pill = new THREE.Mesh(pillGeo.clone(), pillMat);
      pill.rotation.x = -Math.PI / 2;
      pill.position.set(x, 0.02, 1.10);
      this.headerGroup.add(pill);

      const header = new Text();
      header.font = resolvedPixelFontUrl;
      header.sdfGlyphSize = 128;
      header.maxWidth = layout.laneWidth * 0.84;
      const trackLabel = (meta?.name || `TRK ${trkIdx + 1}`).slice(0, maxNameChars);
      header.text = trackLabel;
      header.fontSize = fontSize;
      header.color = TRACK_HEX_PALETTE[trkIdx % TRACK_HEX_PALETTE.length]!;
      header.anchorX = 'center';
      header.anchorY = 'middle';
      header.rotation.x = -Math.PI / 2;
      header.position.set(x, 0.04, 1.10);
      header.sync();
      this.headerGroup.add(header);
    }
    pillGeo.dispose();
  }

  public update(frame: FrameState, layout: LaneLayout): void {
    let cellCount = 0;
    let labelCount = 0;

    const cellWidth = layout.laneWidth * 0.86;
    const cellDepth = STEP_Z_SPACING * 0.78;

    const labelCandidates: Array<{
      x: number;
      y: number;
      z: number;
      distSteps: number;
      noteText: string;
      noteColor: THREE.Color;
      colorKey: string;
    }> = [];

    for (let i = 0; i < frame.visibleNotes.length; i++) {
      const note = frame.visibleNotes[i]!;
      const laneIdx = layout.trackToLaneIndex.get(note.trackIndex);
      if (laneIdx === undefined) continue;

      const x = layout.getLaneX(laneIdx);
      const deltaSteps = note.gridStepFloat - frame.gridStepFloat;
      if (deltaSteps < -0.18) {
        continue;
      }

      const z = -deltaSteps * STEP_Z_SPACING;
      const isTriggering =
        frame.isPlaying && deltaSteps <= 0.18 && deltaSteps >= -0.18 && note.kind === 'note';
      const consumeScale = deltaSteps < 0 ? Math.max(0, 1 + deltaSteps / 0.18) : 1;

      const blockHeight = (note.kind === 'note' ? 0.36 : 0.16) * consumeScale;

      const trackColorIdx = note.trackIndex % TRACK_THREE_COLORS.length;
      const neonCol = TRACK_THREE_COLORS[trackColorIdx]!;
      const textCol = TRACK_TEXT_COLORS[trackColorIdx]!;
      const colorKey = isTriggering
        ? 'trig'
        : note.kind !== 'note'
          ? 'off'
          : `track:${trackColorIdx}`;

      // 1. Unified 3D pixel-bordered brick
      if (cellCount < MAX_NOTE_INSTANCES) {
        const depthScale = (note.kind === 'note' ? cellDepth : cellDepth * 0.6) * consumeScale;
        this.dummy.position.set(x, blockHeight / 2, z);
        this.dummy.scale.set(cellWidth * consumeScale, blockHeight, depthScale);
        this.dummy.updateMatrix();

        if (isTriggering) {
          this.tempColor.copy(this.cellTriggerColor);
        } else if (note.kind !== 'note') {
          this.tempColor.copy(this.offCellColor);
        } else {
          this.tempColor.copy(neonCol);
        }

        this.cellInstanced.setMatrixAt(cellCount, this.dummy.matrix);
        this.cellInstanced.setColorAt(cellCount, this.tempColor);
        cellCount++;
      }

      // 2. Queue crisp centered pixel-retro Note text on top of the block
      if (deltaSteps >= -0.05 && deltaSteps <= 22) {
        labelCandidates.push({
          x,
          y: blockHeight + 0.015,
          z,
          distSteps: Math.abs(deltaSteps),
          noteText: note.noteLabel.replace('-', ''),
          noteColor: isTriggering
            ? TRIGGER_TEXT_COLOR
            : note.kind === 'note'
              ? textCol
              : OFF_TEXT_COLOR,
          colorKey,
        });
      }
    }

    this.cellInstanced.count = cellCount;
    this.cellInstanced.instanceMatrix.needsUpdate = true;
    if (this.cellInstanced.instanceColor) {
      this.cellInstanced.instanceColor.needsUpdate = true;
    }

    // Update pooled troika-three-text labels
    labelCandidates.sort((a, b) => a.distSteps - b.distSteps);
    const maxLabels = Math.min(LABEL_POOL_SIZE, labelCandidates.length);
    const noteFontSize = Math.min(0.46, layout.laneWidth * 0.34);

    for (let i = 0; i < maxLabels; i++) {
      const cand = labelCandidates[i]!;
      const pooled = this.labelPool[i]!;

      pooled.noteMesh.visible = true;
      pooled.noteMesh.position.set(cand.x, cand.y, cand.z);
      pooled.noteMesh.fontSize = noteFontSize;

      if (pooled.lastNoteText !== cand.noteText || pooled.lastColorKey !== cand.colorKey) {
        pooled.noteMesh.text = cand.noteText;
        pooled.noteMesh.color = cand.noteColor;
        pooled.lastNoteText = cand.noteText;
        pooled.lastColorKey = cand.colorKey;
        pooled.noteMesh.sync();
      }

      labelCount++;
    }

    for (let i = labelCount; i < LABEL_POOL_SIZE; i++) {
      this.labelPool[i]!.noteMesh.visible = false;
    }
  }

  public dispose(): void {
    for (const p of this.labelPool) {
      p.noteMesh.dispose();
    }
  }
}
