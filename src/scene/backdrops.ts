import * as THREE from 'three';
import type { AudioAnalysisFrame } from '../audio/audioAnalyzer.ts';
import type { BackdropMode } from '../types/timeline.ts';
import { LOOKAHEAD_STEPS, STEP_Z_SPACING } from './constants.ts';

// ---------------------------------------------------------------------------
// Shared Shader Snippets
// ---------------------------------------------------------------------------
const BASIC_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OUTRUN_SUN_FRAG = /* glsl */ `
  uniform float uBass;
  uniform float uRms;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float radius = 0.62 + uBass * 0.08;

    // Soft outer atmospheric halo
    float halo = exp(-max(0.0, r - radius) * (4.5 - uBass * 1.5)) * (0.28 + uRms * 0.65);

    // Core sun disc
    float disc = smoothstep(radius + 0.015, radius - 0.015, r);

    // Classic horizontal scanline slices on bottom half of sun
    float sliceMask = 1.0;
    if (p.y < 0.08) {
      float band = fract((p.y + 0.7 - uTime * 0.04) * 11.0);
      float cutThickness = smoothstep(0.1, -0.55, p.y) * 0.58;
      sliceMask = step(cutThickness, band);
    }

    vec3 topCol = vec3(1.0, 0.92, 0.25);
    vec3 midCol = vec3(1.0, 0.42, 0.12);
    vec3 botCol = vec3(1.0, 0.12, 0.58);
    float gradT = clamp((p.y + radius) / (2.0 * radius), 0.0, 1.0);
    vec3 sunCol = gradT > 0.5
      ? mix(midCol, topCol, (gradT - 0.5) * 2.0)
      : mix(botCol, midCol, gradT * 2.0);

    vec3 haloCol = mix(vec3(1.0, 0.18, 0.58), vec3(0.55, 0.22, 0.95), clamp(r, 0.0, 1.0));
    vec3 col = sunCol * disc * sliceMask + haloCol * halo * (1.0 - disc * sliceMask * 0.5);
    float alpha = clamp(disc * sliceMask + halo, 0.0, 1.0);

    gl_FragColor = vec4(col, alpha);
  }
`;

const DEMOSCENE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uRms;
  varying vec2 vUv;

  void main() {
    // Calm, moody pixel-quantized backdrop so the 3D wireframe shapes stay the hero
    vec2 grid = vec2(72.0, 36.0);
    vec2 uv = floor(vUv * grid) / grid;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= 2.0;

    float d = length(p);
    float wave = sin(d * 3.2 - uTime * 0.65) * 0.5 + cos(p.x * 2.0 + uTime * 0.35) * 0.5;

    vec3 deepBg = vec3(0.03, 0.05, 0.12);
    vec3 cyanTint = vec3(0.0, 0.42, 0.58);
    vec3 violetTint = vec3(0.28, 0.10, 0.48);

    vec3 col = mix(deepBg, violetTint, smoothstep(-0.6, 0.6, wave));
    col = mix(col, cyanTint, smoothstep(0.25, 0.95, wave) * (0.35 + uBass * 0.45));

    float vignette = smoothstep(1.85, 0.25, length(p));
    float alpha = vignette * (0.22 + uRms * 0.35);
    gl_FragColor = vec4(col, alpha);
  }
`;

const PLASMA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uRms;
  uniform float uBands[16];
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.02;
      a *= 0.5;
    }
    return v;
  }

  float sampleSymmetricSpectrum(float xNorm) {
    float dist = abs(xNorm - 0.5) * 2.0;
    float idxF = clamp(dist * 15.0, 0.0, 14.999);
    int i0 = int(floor(idxF));
    int i1 = min(15, i0 + 1);
    float frac = fract(idxF);
    float v0 = 0.0;
    float v1 = 0.0;
    for (int k = 0; k < 16; k++) {
      if (k == i0) v0 = uBands[k];
      if (k == i1) v1 = uBands[k];
    }
    return mix(v0, v1, smoothstep(0.0, 1.0, frac));
  }

  void main() {
    vec2 uv = vUv;
    float spec = sampleSymmetricSpectrum(uv.x);
    vec2 q = vec2(
      fbm(vec2(uv.x * 3.2 + uTime * 0.08, uv.y * 2.4 - uTime * 0.05)),
      fbm(vec2(uv.x * 3.2 - uTime * 0.06 + 5.2, uv.y * 2.4 + uTime * 0.04 + 1.3))
    );
    float plasma = fbm(vec2(uv.x * 2.6, uv.y * 2.1) + q * (1.1 + uMid * 0.7) + vec2(0.0, -uTime * 0.06));
    float energy = clamp(uRms * 1.25 + uBass * 0.55 + spec * 0.35, 0.0, 1.0);
    float waveHeight = 0.04 + spec * (0.38 + uBass * 0.24) + plasma * (0.28 * energy);
    float cloudMask = smoothstep(waveHeight + 0.18, waveHeight - 0.16, uv.y);
    float ridge = exp(-abs(uv.y - (0.04 + spec * 0.24)) * (10.0 - uBass * 4.0)) * energy;

    float sideFade = smoothstep(0.0, 0.22, uv.x) * smoothstep(1.0, 0.78, uv.x);
    float bottomFade = smoothstep(0.0, 0.08, uv.y);
    float topFade = smoothstep(1.0, 0.72, uv.y);
    float alphaMask = clamp((cloudMask * 0.8 + ridge * 0.6) * sideFade * bottomFade * topFade, 0.0, 1.0);

    vec3 cyan = vec3(0.0, 0.94, 1.0);
    vec3 violet = vec3(0.58, 0.24, 0.96);
    vec3 magenta = vec3(1.0, 0.18, 0.58);
    float centerDist = abs(uv.x - 0.5) * 2.0;
    vec3 baseGrad = mix(cyan, violet, smoothstep(0.05, 0.65, centerDist));
    baseGrad = mix(baseGrad, magenta, smoothstep(0.45, 1.0, centerDist + plasma * 0.25));

    vec3 col = baseGrad * (0.25 + plasma * 0.85 + uRms * 0.65);
    col += mix(cyan, magenta, plasma) * ridge * (0.5 + uBass * 0.8 + uHigh * 0.4);
    float silenceGate = smoothstep(0.015, 0.25, uRms * 0.85 + uBass * 0.45 + spec * 0.35);
    gl_FragColor = vec4(col, alphaMask * silenceGate);
  }
`;

// ---------------------------------------------------------------------------
// Backdrop Manager (all 6 creative backdrops + 'none')
// ---------------------------------------------------------------------------
export class BackdropManager {
  public readonly group = new THREE.Group();

  private mode: BackdropMode = 'outrun';
  private elapsed = 0;
  private horizonZ = -LOOKAHEAD_STEPS * STEP_Z_SPACING - 6;

  // 1. Outrun Sun + Wireframe Mountains
  private outrunGroup = new THREE.Group();
  private outrunUniforms = {
    uBass: { value: 0 },
    uRms: { value: 0 },
    uTime: { value: 0 },
  };
  private mountainGeo!: THREE.PlaneGeometry;
  private mountainBaseY!: Float32Array;
  private mountainMat!: THREE.MeshBasicMaterial;
  private mountainScroll = 0;
  private smoothBass = 0;
  private smoothRms = 0;

  // 2. 3D Joy Division Waterfall Spectrogram
  private waterfallGroup = new THREE.Group();
  private waterfallRows = 26;
  private waterfallCols = 48;
  private waterfallLines: THREE.Line[] = [];
  private waterfallHistory: Float32Array[] = [];
  private waterfallTimer = 0;

  // 3. Demoscene Pixel-Tunnel + Morphing Geometry
  private demosceneGroup = new THREE.Group();
  private demosceneUniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uRms: { value: 0 },
  };
  private demoIco!: THREE.LineSegments;
  private demoTorus!: THREE.LineSegments;
  private icoBasePos!: Float32Array;
  private icoGeo!: THREE.BufferGeometry;

  // 4. Hyperspace Warp Gates & Pixel Starfield
  private hyperspaceGroup = new THREE.Group();
  private starCount = 340;
  private starPos!: Float32Array;
  private starGeo!: THREE.BufferGeometry;
  private starMat!: THREE.PointsMaterial;
  private warpGates: THREE.LineLoop[] = [];
  private gateZBase: number[] = [];

  // 5. Giant Live Stereo Oscilloscope (thick 3D glowing ribbon meshes)
  private scopeGroup = new THREE.Group();
  private scopePoints = 128;
  private scopeRibbonL!: THREE.Mesh;
  private scopeRibbonR!: THREE.Mesh;
  private scopeEchoL!: THREE.Line;
  private scopeEchoR!: THREE.Line;
  private scopeSmoothL = new Float32Array(128);
  private scopeSmoothR = new Float32Array(128);
  private scopeWidth = 56;

  // 6. Synthwave Plasma Cloud
  private plasmaGroup = new THREE.Group();
  private plasmaUniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uRms: { value: 0 },
    uBands: { value: new Array<number>(16).fill(0) },
  };

  constructor() {
    this.buildOutrun();
    this.buildWaterfall();
    this.buildDemoscene();
    this.buildHyperspace();
    this.buildOscilloscope();
    this.buildPlasma();

    this.group.add(
      this.outrunGroup,
      this.waterfallGroup,
      this.demosceneGroup,
      this.hyperspaceGroup,
      this.scopeGroup,
      this.plasmaGroup
    );
    this.setMode('outrun');
  }

  public setMode(mode: BackdropMode): void {
    this.mode = mode;
    this.outrunGroup.visible = mode === 'outrun';
    this.waterfallGroup.visible = mode === 'waterfall';
    this.demosceneGroup.visible = mode === 'demoscene';
    this.hyperspaceGroup.visible = mode === 'hyperspace';
    this.scopeGroup.visible = mode === 'oscilloscope';
    this.plasmaGroup.visible = mode === 'plasma';
  }

  // ---- 1. Outrun Sun + Wireframe Mountains ----
  private buildOutrun(): void {
    const sunGeo = new THREE.PlaneGeometry(34, 34);
    const sunMat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: OUTRUN_SUN_FRAG,
      uniforms: this.outrunUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    sun.position.set(0, 12.5, this.horizonZ - 6);
    this.outrunGroup.add(sun);

    this.mountainGeo = new THREE.PlaneGeometry(96, 32, 36, 12);
    this.mountainGeo.rotateX(-Math.PI / 2);
    const pos = this.mountainGeo.attributes.position as THREE.BufferAttribute;
    this.mountainBaseY = new Float32Array(pos.count);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Keep a clear valley in the middle for the highway & sun
      const valley = Math.min(1, Math.max(0, (Math.abs(x) - 8) / 14));
      const ridge =
        (Math.sin(x * 0.22) * 2.2 + Math.cos(z * 0.35) * 1.6 + Math.sin(x * 0.55 + z * 0.4) * 1.1 + 3.2) *
        valley;
      this.mountainBaseY[i] = ridge;
      pos.setY(i, ridge);
    }

    this.mountainMat = new THREE.MeshBasicMaterial({
      color: '#a855f7',
      wireframe: true,
      transparent: true,
      opacity: 0.72,
      fog: false,
    });
    const mountains = new THREE.Mesh(this.mountainGeo, this.mountainMat);
    mountains.position.set(0, -0.5, this.horizonZ + 4);
    this.outrunGroup.add(mountains);
  }

  // ---- 2. 3D Joy Division Waterfall Spectrogram ----
  private buildWaterfall(): void {
    for (let r = 0; r < this.waterfallRows; r++) {
      const hist = new Float32Array(this.waterfallCols);
      this.waterfallHistory.push(hist);

      const positions = new Float32Array(this.waterfallCols * 3);
      for (let c = 0; c < this.waterfallCols; c++) {
        const x = ((c / (this.waterfallCols - 1)) - 0.5) * 64;
        positions[c * 3] = x;
        positions[c * 3 + 1] = 0;
        positions[c * 3 + 2] = 0;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const t = r / (this.waterfallRows - 1);
      const col = new THREE.Color('#00f0ff').lerp(new THREE.Color('#ff2e93'), t);
      const mat = new THREE.LineBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.95 - t * 0.65,
        fog: false,
      });

      const line = new THREE.Line(geo, mat);
      line.position.set(0, 1.5 + t * 5.0, -46 - t * 44);
      this.waterfallGroup.add(line);
      this.waterfallLines.push(line);
    }
  }

  // ---- 3. Demoscene Pixel-Tunnel + Morphing Geometry ----
  private buildDemoscene(): void {
    const bgGeo = new THREE.PlaneGeometry(88, 36);
    const bgMat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: DEMOSCENE_FRAG,
      uniforms: this.demosceneUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.position.set(0, 12, this.horizonZ - 6);
    this.demosceneGroup.add(bg);

    const rawIco = new THREE.IcosahedronGeometry(5.5, 1);
    const edgesIco = new THREE.EdgesGeometry(rawIco);
    this.icoGeo = edgesIco;
    const pos = this.icoGeo.attributes.position as THREE.BufferAttribute;
    this.icoBasePos = new Float32Array(pos.array.length);
    this.icoBasePos.set(pos.array as Float32Array);

    this.demoIco = new THREE.LineSegments(
      this.icoGeo,
      new THREE.LineBasicMaterial({ color: '#00f0ff', fog: false })
    );
    this.demoIco.position.set(0, 11.5, this.horizonZ + 4);
    this.demosceneGroup.add(this.demoIco);

    const torusEdges = new THREE.EdgesGeometry(new THREE.TorusGeometry(9.2, 0.9, 8, 24));
    this.demoTorus = new THREE.LineSegments(
      torusEdges,
      new THREE.LineBasicMaterial({ color: '#ff2e93', fog: false })
    );
    this.demoTorus.position.set(0, 11.5, this.horizonZ + 4);
    this.demosceneGroup.add(this.demoTorus);
    rawIco.dispose();
  }

  // ---- 4. Hyperspace Warp Gates & Pixel Starfield ----
  private buildHyperspace(): void {
    this.starPos = new Float32Array(this.starCount * 3);
    for (let i = 0; i < this.starCount; i++) {
      this.resetStar(i, Math.random() * 110 - 95);
    }
    this.starGeo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.starPos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.starGeo.setAttribute('position', attr);

    this.starMat = new THREE.PointsMaterial({
      color: '#e0f2fe',
      size: 0.48,
      transparent: true,
      opacity: 0.9,
      fog: false,
    });
    const stars = new THREE.Points(this.starGeo, this.starMat);
    this.hyperspaceGroup.add(stars);

    const gateVerts = new Float32Array([
      -12, -1, 0,
      12, -1, 0,
      14, 13, 0,
      -14, 13, 0,
    ]);
    const gateGeo = new THREE.BufferGeometry();
    gateGeo.setAttribute('position', new THREE.BufferAttribute(gateVerts, 3));

    for (let i = 0; i < 10; i++) {
      const col = i % 2 === 0 ? '#00f0ff' : '#ff2e93';
      const gate = new THREE.LineLoop(
        gateGeo,
        new THREE.LineBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.45,
          fog: false,
        })
      );
      const baseZ = -8 - i * 8.5;
      gate.position.set(0, 0, baseZ);
      this.hyperspaceGroup.add(gate);
      this.warpGates.push(gate);
      this.gateZBase.push(baseZ);
    }
  }

  private resetStar(i: number, z: number): void {
    // Keep stars outside the highway deck so they never clip through notes
    let x = (Math.random() - 0.5) * 68;
    let y = Math.random() * 34 - 4;
    if (Math.abs(x) < 9.5 && y < 3.5) {
      x = x < 0 ? -10 - Math.random() * 20 : 10 + Math.random() * 20;
    }
    this.starPos[i * 3] = x;
    this.starPos[i * 3 + 1] = y;
    this.starPos[i * 3 + 2] = z;
  }

  // ---- 5. Giant Live Stereo Oscilloscope (Thick Glowing Ribbons) ----
  private buildOscilloscope(): void {
    const scopeZ = -60;
    const w = this.scopeWidth;
    const h = 20;

    // Subtle CRT graticule grid
    const gridVerts: number[] = [];
    for (let x = -w / 2; x <= w / 2; x += 4) {
      gridVerts.push(x, -h / 2, 0, x, h / 2, 0);
    }
    for (let y = -h / 2; y <= h / 2; y += 2.5) {
      gridVerts.push(-w / 2, y, 0, w / 2, y, 0);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    const grid = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({
        color: '#25324a',
        transparent: true,
        opacity: 0.65,
        fog: false,
      })
    );
    grid.position.set(0, 12.5, scopeZ - 1.5);
    this.scopeGroup.add(grid);

    const makeRibbon = (color: string, yBase: number) => {
      // Triangle-strip ribbon mesh so waveform has real thickness at distance
      const verts = new Float32Array(this.scopePoints * 2 * 3);
      const indices: number[] = [];
      for (let i = 0; i < this.scopePoints; i++) {
        const x = ((i / (this.scopePoints - 1)) - 0.5) * w;
        verts[i * 6] = x;
        verts[i * 6 + 1] = yBase - 0.28;
        verts[i * 6 + 2] = 0;
        verts[i * 6 + 3] = x;
        verts[i * 6 + 4] = yBase + 0.28;
        verts[i * 6 + 5] = 0;
        if (i < this.scopePoints - 1) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(indices);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          fog: false,
        })
      );
      mesh.position.set(0, 0, scopeZ);
      this.scopeGroup.add(mesh);
      return mesh;
    };

    const makeEchoLine = (color: string, yBase: number) => {
      const pts = new Float32Array(this.scopePoints * 3);
      for (let i = 0; i < this.scopePoints; i++) {
        pts[i * 3] = ((i / (this.scopePoints - 1)) - 0.5) * w;
        pts[i * 3 + 1] = yBase;
        pts[i * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, fog: false })
      );
      line.position.set(0, 0, scopeZ - 0.8);
      this.scopeGroup.add(line);
      return line;
    };

    this.scopeRibbonL = makeRibbon('#00f0ff', 15.8);
    this.scopeEchoL = makeEchoLine('#00f0ff', 15.8);
    this.scopeRibbonR = makeRibbon('#ff2e93', 9.2);
    this.scopeEchoR = makeEchoLine('#ff2e93', 9.2);
  }

  // ---- 6. Synthwave Plasma Cloud ----
  private buildPlasma(): void {
    const geo = new THREE.PlaneGeometry(92, 30);
    const mat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: PLASMA_FRAG,
      uniforms: this.plasmaUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 11.5, this.horizonZ);
    this.plasmaGroup.add(mesh);
  }

  // ---------------------------------------------------------------------------
  // Per-Frame Update (only active mode updates)
  // ---------------------------------------------------------------------------
  public update(analysis: AudioAnalysisFrame | null, dt: number): void {
    if (this.mode === 'none') return;
    this.elapsed += dt;

    const rawBass = analysis?.bass ?? 0;
    const mid = analysis?.mid ?? 0;
    const high = analysis?.high ?? 0;
    const rawRms = analysis?.rms ?? 0;

    // Extra temporal smoothing for calm, non-manic horizon motion
    const kSmooth = 1 - Math.exp(-dt * 6.5);
    this.smoothBass += (rawBass - this.smoothBass) * kSmooth;
    this.smoothRms += (rawRms - this.smoothRms) * kSmooth;
    const bass = this.smoothBass;
    const rms = this.smoothRms;

    if (this.mode === 'outrun') {
      this.outrunUniforms.uBass.value = bass;
      this.outrunUniforms.uRms.value = rms;
      this.outrunUniforms.uTime.value = this.elapsed;

      // Integrate scroll monotonically so mountains glide forward smoothly without jumping
      this.mountainScroll += dt * (1.1 + rms * 1.6);
      const pos = this.mountainGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const valley = Math.min(1, Math.max(0, (Math.abs(x) - 8) / 14));
        const bandIdx = Math.min(19, Math.floor((Math.abs(x) / 48) * 19));
        const bPrev = analysis?.bands[Math.max(0, bandIdx - 1)] ?? 0;
        const bCurr = analysis?.bands[bandIdx] ?? 0;
        const bNext = analysis?.bands[Math.min(19, bandIdx + 1)] ?? 0;
        const bSmooth = bPrev * 0.25 + bCurr * 0.5 + bNext * 0.25;

        const movingWave =
          Math.sin(x * 0.22) * 1.8 +
          Math.cos(z * 0.35 + this.mountainScroll) * 1.7 +
          Math.sin(x * 0.45 + z * 0.35 + this.mountainScroll * 0.7) * 0.9;
        const dynamicPeak = (movingWave + 3.0 + bass * 3.5 + bSmooth * 9.0) * valley;
        pos.setY(i, Math.max(0, dynamicPeak));
      }
      pos.needsUpdate = true;
      this.mountainMat.color
        .set('#7c3aed')
        .lerp(new THREE.Color('#00f0ff'), Math.min(1, bass * 1.3 + rms * 0.35));
    } else if (this.mode === 'waterfall') {
      this.waterfallTimer += dt;
      if (this.waterfallTimer >= 1 / 35) {
        this.waterfallTimer = 0;
        for (let r = this.waterfallRows - 1; r > 0; r--) {
          this.waterfallHistory[r]!.set(this.waterfallHistory[r - 1]!);
        }
        const front = this.waterfallHistory[0]!;
        for (let c = 0; c < this.waterfallCols; c++) {
          const distFromCenter = Math.abs(c / (this.waterfallCols - 1) - 0.5) * 2;
          const bIdx = Math.min(19, Math.floor(distFromCenter * 18));
          const val = analysis ? (analysis.bands[bIdx] ?? 0) : 0;
          const arch = 1 - Math.pow(distFromCenter, 2.2) * 0.45;
          front[c] = val * 8.5 * arch;
        }
      }

      for (let r = 0; r < this.waterfallRows; r++) {
        const line = this.waterfallLines[r]!;
        const pos = line.geometry.attributes.position as THREE.BufferAttribute;
        const hist = this.waterfallHistory[r]!;
        for (let c = 0; c < this.waterfallCols; c++) {
          pos.setY(c, hist[c] ?? 0);
        }
        pos.needsUpdate = true;
      }
    } else if (this.mode === 'demoscene') {
      this.demosceneUniforms.uTime.value = this.elapsed;
      this.demosceneUniforms.uBass.value = bass;
      this.demosceneUniforms.uMid.value = mid;
      this.demosceneUniforms.uHigh.value = high;
      this.demosceneUniforms.uRms.value = rms;

      const spin = 0.35 + rms * 2.2;
      this.demoIco.rotation.x += dt * spin * 0.8;
      this.demoIco.rotation.y += dt * spin;
      this.demoTorus.rotation.x -= dt * spin * 0.55;
      this.demoTorus.rotation.z += dt * spin * 0.7;

      const pos = this.icoGeo.attributes.position as THREE.BufferAttribute;
      const spike = 1 + bass * 0.45 + high * 0.35;
      for (let i = 0; i < pos.count; i++) {
        const bx = this.icoBasePos[i * 3]!;
        const by = this.icoBasePos[i * 3 + 1]!;
        const bz = this.icoBasePos[i * 3 + 2]!;
        const wobble = 1 + Math.sin(bx * 0.9 + this.elapsed * 5.0) * high * 0.25;
        const s = spike * wobble;
        pos.setXYZ(i, bx * s, by * s, bz * s);
      }
      pos.needsUpdate = true;
    } else if (this.mode === 'hyperspace') {
      const speed = 14 + rms * 75 + bass * 55;
      this.starMat.size = 0.45 + bass * 0.7 + rms * 0.35;
      const pos = this.starGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < this.starCount; i++) {
        let z = pos.getZ(i) + speed * dt;
        if (z > 14) {
          this.resetStar(i, -95 - Math.random() * 15);
          z = this.starPos[i * 3 + 2]!;
        } else {
          pos.setZ(i, z);
        }
      }
      pos.needsUpdate = true;

      for (let g = 0; g < this.warpGates.length; g++) {
        const gate = this.warpGates[g]!;
        const band = analysis?.bands[Math.min(19, g * 2)] ?? 0;
        const pulse = 1 + band * 0.38 + bass * 0.25;
        gate.scale.set(pulse, pulse, 1);
        // Subtle forward warp surge on bass hits
        const baseZ = this.gateZBase[g] ?? -8;
        gate.position.z = baseZ + bass * 3.5;
        (gate.material as THREE.LineBasicMaterial).opacity = 0.22 + band * 0.78;
      }
    } else if (this.mode === 'oscilloscope') {
      const posL = this.scopeRibbonL.geometry.attributes.position as THREE.BufferAttribute;
      const posR = this.scopeRibbonR.geometry.attributes.position as THREE.BufferAttribute;
      const echoL = this.scopeEchoL.geometry.attributes.position as THREE.BufferAttribute;
      const echoR = this.scopeEchoR.geometry.attributes.position as THREE.BufferAttribute;
      const halfThick = 0.24 + rms * 0.2;
      const waveBlend = 1 - Math.exp(-dt * 18);

      for (let i = 0; i < this.scopePoints; i++) {
        const rawL = Math.max(-1, Math.min(1, (analysis?.waveL[i] ?? 0) * 2.0));
        const rawR = Math.max(-1, Math.min(1, (analysis?.waveR[i] ?? 0) * 2.0));
        this.scopeSmoothL[i] = (this.scopeSmoothL[i] ?? 0) + (rawL - (this.scopeSmoothL[i] ?? 0)) * waveBlend;
        this.scopeSmoothR[i] = (this.scopeSmoothR[i] ?? 0) + (rawR - (this.scopeSmoothR[i] ?? 0)) * waveBlend;

        const yL = 15.8 + (this.scopeSmoothL[i] ?? 0) * 6.0;
        const yR = 9.2 + (this.scopeSmoothR[i] ?? 0) * 6.0;

        posL.setY(i * 2, yL - halfThick);
        posL.setY(i * 2 + 1, yL + halfThick);
        posR.setY(i * 2, yR - halfThick);
        posR.setY(i * 2 + 1, yR + halfThick);

        echoL.setY(i, echoL.getY(i) * 0.85 + yL * 0.15);
        echoR.setY(i, echoR.getY(i) * 0.85 + yR * 0.15);
      }
      posL.needsUpdate = true;
      posR.needsUpdate = true;
      echoL.needsUpdate = true;
      echoR.needsUpdate = true;
    } else if (this.mode === 'plasma') {
      this.plasmaUniforms.uTime.value = this.elapsed;
      this.plasmaUniforms.uBass.value = bass;
      this.plasmaUniforms.uMid.value = mid;
      this.plasmaUniforms.uHigh.value = high;
      this.plasmaUniforms.uRms.value = rms;
      const arr = this.plasmaUniforms.uBands.value;
      if (analysis) {
        for (let i = 0; i < 16; i++) {
          const bPrev = analysis.bands[Math.max(0, i - 1)] ?? 0;
          const bCurr = analysis.bands[i] ?? 0;
          const bNext = analysis.bands[Math.min(19, i + 1)] ?? 0;
          arr[i] = bPrev * 0.25 + bCurr * 0.5 + bNext * 0.25;
        }
      } else {
        arr.fill(0);
      }
    }
  }
}
