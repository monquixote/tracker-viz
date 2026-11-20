import * as THREE from 'three';
import type { AudioAnalysisFrame } from '../audio/audioAnalyzer.ts';
import type {
  BackdropMode,
  CameraPreset,
  CompiledTimeline,
  FrameState,
  LaneMode,
  PatternDisplayMode,
} from '../types/timeline.ts';
import { BackdropManager } from './backdrops.ts';
import { computeLaneLayout, type LaneLayout } from './constants.ts';
import { LaneGrid } from './laneGrid.ts';
import { NoteHighway } from './noteHighway.ts';
import { PatternGantries } from './patternGantries.ts';
import { StrikeZone } from './strikeZone.ts';

type StaticCameraPreset = 'classic' | 'low' | 'top' | 'side';
type DynamicCameraPreset = Exclude<CameraPreset, StaticCameraPreset>;

interface CameraPose {
  pos: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

const STATIC_CAMERA_PRESETS: Record<StaticCameraPreset, CameraPose> = {
  classic: { pos: [0, 8.3, 11.6], lookAt: [0, 0.2, -14], fov: 51 },
  low: { pos: [0, 4.6, 9.6], lookAt: [0, 0.55, -17], fov: 54 },
  top: { pos: [0, 20.0, 6.4], lookAt: [0, 0, -6.5], fov: 48 },
  side: { pos: [12.2, 7.6, 10.4], lookAt: [-1.0, 0.2, -11.5], fov: 48 },
};

function smootherstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function isStaticCameraPreset(preset: CameraPreset): preset is StaticCameraPreset {
  return preset in STATIC_CAMERA_PRESETS;
}

function evaluateDynamicCameraPose(
  preset: DynamicCameraPreset,
  timeSec: number,
  gridStepFloat: number,
  songRow: number,
  stepInRow: number,
  rowSteps: number
): CameraPose {
  switch (preset) {
    case 'orbit': {
      const phase = timeSec * ((Math.PI * 2) / 18);
      const s = Math.sin(phase);
      const absS = Math.abs(s);
      return {
        pos: [s * 8.2, 7.6 + absS * 1.1, 11.8 + absS * 0.6],
        lookAt: [-s * 0.85, 0.25, -12.5 - (1 - absS) * 1.2],
        fov: 51,
      };
    }
    case 'drift': {
      const p = (gridStepFloat / 128) * Math.PI * 2;
      const x = Math.sin(p) * 5.6;
      const y = 8.4 + Math.sin(p * 2) * 1.0;
      const z = 12.6 + Math.cos(p) * 0.7;
      return {
        pos: [x, y, z],
        lookAt: [-x * 0.1, 0.2 + Math.cos(p * 2) * 0.15, -11.8],
        fov: 51 + Math.sin(p) * 1.4,
      };
    }
    case 'drone': {
      const p = timeSec * ((Math.PI * 2) / 14);
      const s = Math.sin(p);
      return {
        pos: [s * 5.0, 4.9 + Math.cos(p * 2) * 0.5, 10.6 + Math.abs(s) * 0.6],
        lookAt: [-s * 0.9, 0.55, -15.2],
        fov: 54,
      };
    }
    case 'crane': {
      const p = (gridStepFloat / 192) * Math.PI * 2;
      const s = Math.sin(p);
      const centerAmt = 1 - Math.abs(s);
      return {
        pos: [s * 11.2, 8.0 + centerAmt * 4.4, 11.8 + centerAmt * 1.6],
        lookAt: [-s * 0.85, 0.1, -10.2 - centerAmt * 1.0],
        fov: 50,
      };
    }
    case 'sweep': {
      const classic = STATIC_CAMERA_PRESETS.classic;
      const side = STATIC_CAMERA_PRESETS.side;
      const transitionSteps = Math.min(16, Math.max(6, rowSteps * 0.25));
      const progress = smootherstep01(stepInRow / transitionSteps);
      // Row 0 starts and holds on Classic; odd rows sweep Classic -> Side and hold;
      // subsequent even rows sweep Side -> Classic and hold.
      const b = songRow === 0 ? 0 : songRow % 2 === 1 ? progress : 1 - progress;
      const arcZ = Math.sin(b * Math.PI) * 1.4;
      return {
        pos: [
          lerp(classic.pos[0], side.pos[0], b),
          lerp(classic.pos[1], side.pos[1], b),
          lerp(classic.pos[2], side.pos[2], b) + arcZ,
        ],
        lookAt: [
          lerp(classic.lookAt[0], side.lookAt[0], b),
          lerp(classic.lookAt[1], side.lookAt[1], b),
          lerp(classic.lookAt[2], side.lookAt[2], b),
        ],
        fov: lerp(classic.fov, side.fov, b),
      };
    }
  }
}

export class HighwayScene {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;

  private laneGrid: LaneGrid;
  private noteHighway: NoteHighway;
  private strikeZone: StrikeZone;
  private patternGantries: PatternGantries;
  private backdropManager: BackdropManager;
  private leftRimLight: THREE.DirectionalLight;
  private rightRimLight: THREE.DirectionalLight;
  private backRimLight: THREE.DirectionalLight;

  private layout: LaneLayout;
  private timeline: CompiledTimeline | null = null;
  private laneMode: LaneMode = 'auto';
  private cameraPreset: CameraPreset = 'classic';
  private bgColor = new THREE.Color('#05070e');

  constructor(container: HTMLElement) {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'default',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.bgColor;
    this.scene.fog = new THREE.FogExp2('#05070e', 0.019);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 180);
    this.setCameraPreset('classic');

    // 3-point studio lighting tuned for saturated 3D block depth + punchy reactive side rims
    const ambient = new THREE.AmbientLight('#475569', 0.4);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight('#ffffff', 1.15);
    keyLight.position.set(10, 14, 16);
    this.scene.add(keyLight);

    this.leftRimLight = new THREE.DirectionalLight('#00f0ff', 0.5);
    this.leftRimLight.position.set(-14, 6, 4);
    this.scene.add(this.leftRimLight);

    this.rightRimLight = new THREE.DirectionalLight('#ff2e93', 0.5);
    this.rightRimLight.position.set(14, 6, 4);
    this.scene.add(this.rightRimLight);

    this.backRimLight = new THREE.DirectionalLight('#a855f7', 0.65);
    this.backRimLight.position.set(0, 6, -18);
    this.scene.add(this.backRimLight);

    this.laneGrid = new LaneGrid();
    this.noteHighway = new NoteHighway();
    this.strikeZone = new StrikeZone();
    this.patternGantries = new PatternGantries();
    this.backdropManager = new BackdropManager();

    this.scene.add(this.laneGrid.group);
    this.scene.add(this.noteHighway.group);
    this.scene.add(this.strikeZone.group);
    this.scene.add(this.patternGantries.group);
    this.scene.add(this.backdropManager.group);

    this.layout = computeLaneLayout([0, 1, 2, 3, 4, 5, 6, 7]);
    this.rebuildGeometry();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public setTimeline(timeline: CompiledTimeline | null): void {
    this.timeline = timeline;
    this.rebuildGeometry();
  }

  public refreshHeaders(): void {
    this.noteHighway.rebuildHeaders(this.layout, this.timeline?.tracks ?? []);
  }

  public setLaneMode(mode: LaneMode): void {
    this.laneMode = mode;
    this.rebuildGeometry();
  }

  public setBackdropMode(mode: BackdropMode): void {
    this.backdropManager.setMode(mode);
  }

  public setPatternDisplayMode(mode: PatternDisplayMode): void {
    this.patternGantries.setDisplayMode(mode);
  }

  private applyCameraPose(pose: CameraPose): void {
    this.camera.position.set(...pose.pos);
    this.camera.lookAt(...pose.lookAt);
    if (Math.abs(this.camera.fov - pose.fov) > 1e-4) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  public setCameraPreset(preset: CameraPreset): void {
    this.cameraPreset = preset;
    if (isStaticCameraPreset(preset)) {
      this.applyCameraPose(STATIC_CAMERA_PRESETS[preset]);
    } else {
      this.applyCameraPose(evaluateDynamicCameraPose(preset, 0, 0, 0, 0, 32));
    }
  }

  private updateCamera(frame: FrameState): void {
    if (isStaticCameraPreset(this.cameraPreset)) return;
    const currRow = this.timeline?.songRows[frame.songRow];
    const stepInRow = currRow
      ? Math.max(0, frame.gridStepFloat - currRow.startStepFloat)
      : frame.stepIndex + frame.stepProgress;
    const rowSteps = currRow?.stepCount || 32;
    this.applyCameraPose(
      evaluateDynamicCameraPose(
        this.cameraPreset,
        frame.timeSec,
        frame.gridStepFloat,
        frame.songRow,
        stepInRow,
        rowSteps
      )
    );
  }

  public setTransparentBackground(transparent: boolean): void {
    if (transparent) {
      this.scene.background = null;
      this.scene.fog = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.scene.background = this.bgColor;
      this.scene.fog = new THREE.FogExp2('#05070e', 0.019);
      this.renderer.setClearColor(this.bgColor, 1);
    }
    this.laneGrid.setTransparentBackground(transparent);
  }

  private resolveVisibleTracks(): number[] {
    if (!this.timeline) return [0, 1, 2, 3, 4, 5, 6, 7];
    if (this.laneMode === 'auto') {
      return this.timeline.activeTrackIndices;
    }
    const count = this.laneMode;
    return Array.from({ length: count }, (_, i) => i);
  }

  private rebuildGeometry(): void {
    const visibleTracks = this.resolveVisibleTracks();
    this.layout = computeLaneLayout(visibleTracks);
    this.laneGrid.rebuildLanes(this.layout);
    this.strikeZone.rebuildPads(this.layout);
    this.noteHighway.rebuildHeaders(this.layout, this.timeline?.tracks ?? []);
  }

  public getLaneLayout(): LaneLayout {
    return this.layout;
  }

  public renderFrame(
    frame: FrameState,
    dt: number,
    analysis: AudioAnalysisFrame | null = null
  ): void {
    if (frame.justTriggeredNotes.length > 0) {
      this.strikeZone.triggerHits(frame.justTriggeredNotes, this.layout);
    }

    // Reactive side & rim lighting on the 3D blocks and outer rails (visible even without GLOW)
    if (analysis) {
      const bassBoost = Math.min(1, Math.pow(analysis.bass * 1.9, 0.85));
      const highBoost = Math.min(1, Math.pow((analysis.mid + analysis.high) * 1.35, 0.85));
      this.leftRimLight.intensity = 0.35 + bassBoost * 3.4;
      this.rightRimLight.intensity = 0.35 + highBoost * 3.4;
      this.backRimLight.intensity = 0.4 + analysis.rms * 2.2;
    } else {
      this.leftRimLight.intensity = 0.5;
      this.rightRimLight.intensity = 0.5;
      this.backRimLight.intensity = 0.5;
    }

    const totalSteps = this.timeline?.totalSteps ?? 128;
    this.laneGrid.update(frame.gridStepFloat, totalSteps, analysis);
    this.noteHighway.update(frame, this.layout);
    this.strikeZone.update(dt);
    this.patternGantries.update(frame, this.timeline?.songRows ?? [], dt);
    this.backdropManager.update(analysis, dt);
    this.updateCamera(frame);

    this.renderer.render(this.scene, this.camera);
  }

  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.noteHighway.dispose();
    this.patternGantries.dispose();
    this.renderer.dispose();
  }
}
