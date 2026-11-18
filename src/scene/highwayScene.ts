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

const CAMERA_PRESETS: Record<
  CameraPreset,
  { pos: [number, number, number]; lookAt: [number, number, number]; fov: number }
> = {
  classic: { pos: [0, 8.2, 10.5], lookAt: [0, 0.2, -14], fov: 50 },
  low: { pos: [0, 4.4, 8.2], lookAt: [0, 0.6, -18], fov: 56 },
  top: { pos: [0, 18.5, 4.5], lookAt: [0, 0, -10], fov: 46 },
  side: { pos: [11.5, 7.2, 9.0], lookAt: [-1.5, 0.2, -12], fov: 48 },
};

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

  public setCameraPreset(preset: CameraPreset): void {
    const cfg = CAMERA_PRESETS[preset];
    this.camera.fov = cfg.fov;
    this.camera.position.set(...cfg.pos);
    this.camera.lookAt(...cfg.lookAt);
    this.camera.updateProjectionMatrix();
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
    this.laneGrid.update(frame.gridStepFloat, frame.activeMutes, totalSteps, analysis);
    this.noteHighway.update(frame, this.layout);
    this.strikeZone.update(dt);
    this.patternGantries.update(frame, this.timeline?.songRows ?? [], dt);
    this.backdropManager.update(analysis, dt);

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
