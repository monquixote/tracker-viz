import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { AudioAnalyzer } from '../audio/audioAnalyzer.ts';
import type { FrameStateStore } from '../audio/frameStore.ts';
import type { HighwayScene } from '../scene/highwayScene.ts';

export type OfflineFormat = 'mp4' | 'webm';

export interface OfflineExportOptions {
  format: OfflineFormat;
  fps?: number;
  width?: number;
  height?: number;
  videoBitrate?: number;
  audioBuffer: AudioBuffer | null;
  durationSec: number;
  latencyOffsetMs: number;
  drawHudOverlay?: (
    ctx: CanvasRenderingContext2D,
    frame: import('../types/timeline.ts').FrameState,
    durationSec: number
  ) => void;
  onProgress?: (progress01: number, statusText: string) => void;
  signal?: AbortSignal;
}

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

async function resampleAudioBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;
  const targetLen = Math.ceil(buffer.duration * targetRate);
  const offline = new OfflineAudioContext(buffer.numberOfChannels, targetLen, targetRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

export async function runOfflineExport(
  scene: HighwayScene,
  frameStore: FrameStateStore,
  options: OfflineExportOptions
): Promise<{ blob: Blob; extension: string }> {
  if (!isWebCodecsSupported()) {
    throw new Error('WebCodecs (VideoEncoder) is not supported in this browser. Use Live Capture instead.');
  }

  const fps = options.fps ?? 60;
  const canvas = scene.getCanvas();
  const prevWidth = canvas.clientWidth || canvas.width;
  const prevHeight = canvas.clientHeight || canvas.height;
  const prevPixelRatio = scene.renderer.getPixelRatio();

  // Export at crisp 16:9 1080p (or specified size), ensuring even dimensions for H.264 Level 4.2
  const rawW = options.width ?? 1920;
  const rawH = options.height ?? 1080;
  const width = rawW % 2 === 0 ? rawW : rawW - 1;
  const height = rawH % 2 === 0 ? rawH : rawH - 1;

  scene.renderer.setPixelRatio(1);
  scene.resize(width, height);

  const hasAudio = options.audioBuffer !== null && typeof AudioEncoder !== 'undefined';
  const totalFrames = Math.max(1, Math.ceil(options.durationSec * fps));
  const frameDurationUs = Math.round(1_000_000 / fps);

  try {
    if (options.format === 'mp4') {
      const target = new Mp4Target();
      const muxer = new Mp4Muxer({
        target,
        video: { codec: 'avc', width, height },
        audio: hasAudio
          ? {
              codec: 'aac',
              numberOfChannels: options.audioBuffer!.numberOfChannels,
              sampleRate: options.audioBuffer!.sampleRate,
            }
          : undefined,
        fastStart: 'in-memory',
      });

      return await encodeWithMuxer(
        scene,
        frameStore,
        muxer,
        target,
        'mp4',
        'video/mp4',
        'avc1.42002A',
        'mp4a.40.2',
        width,
        height,
        fps,
        totalFrames,
        frameDurationUs,
        options
      );
    } else {
      // Opus in WebCodecs requires 48000 Hz (Tracker WAVs are typically 44100 Hz)
      const webmAudio =
        hasAudio && options.audioBuffer
          ? await resampleAudioBuffer(options.audioBuffer, 48000)
          : null;
      const webmOptions: OfflineExportOptions = {
        ...options,
        audioBuffer: webmAudio,
      };

      const target = new WebmTarget();
      const muxer = new WebmMuxer({
        target,
        video: { codec: 'V_VP9', width, height, frameRate: fps },
        audio: webmAudio
          ? {
              codec: 'A_OPUS',
              numberOfChannels: webmAudio.numberOfChannels,
              sampleRate: webmAudio.sampleRate,
            }
          : undefined,
      });

      return await encodeWithMuxer(
        scene,
        frameStore,
        muxer,
        target,
        'webm',
        'video/webm',
        'vp09.00.10.08',
        'opus',
        width,
        height,
        fps,
        totalFrames,
        frameDurationUs,
        webmOptions
      );
    }
  } finally {
    scene.renderer.setPixelRatio(prevPixelRatio);
    scene.resize(prevWidth, prevHeight);
    frameStore.resetPrevTime(-1);
  }
}

async function encodeWithMuxer(
  scene: HighwayScene,
  frameStore: FrameStateStore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  muxer: any,
  target: { buffer: ArrayBuffer },
  extension: string,
  mimeType: string,
  videoCodec: string,
  audioCodec: string,
  width: number,
  height: number,
  fps: number,
  totalFrames: number,
  frameDurationUs: number,
  options: OfflineExportOptions
): Promise<{ blob: Blob; extension: string }> {
  const canvas = scene.getCanvas();

  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });

  videoEncoder.configure({
    codec: videoCodec,
    width,
    height,
    bitrate: options.videoBitrate ?? 12_000_000,
    framerate: fps,
  });

  // Encode audio if present
  let audioEncoder: AudioEncoder | null = null;
  if (options.audioBuffer && typeof AudioEncoder !== 'undefined') {
    const ab = options.audioBuffer;
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        encoderError = e instanceof Error ? e : new Error(String(e));
      },
    });
    audioEncoder.configure({
      codec: audioCodec,
      numberOfChannels: ab.numberOfChannels,
      sampleRate: ab.sampleRate,
      bitrate: 192_000,
    });

    const chunkFrames = 4096;
    const numCh = ab.numberOfChannels;
    const totalSamples = Math.min(ab.length, Math.ceil(options.durationSec * ab.sampleRate));

    for (let offset = 0; offset < totalSamples; offset += chunkFrames) {
      if (options.signal?.aborted) throw new Error('Export cancelled');
      const count = Math.min(chunkFrames, totalSamples - offset);
      const planar = new Float32Array(count * numCh);
      for (let ch = 0; ch < numCh; ch++) {
        const src = ab.getChannelData(ch);
        planar.set(src.subarray(offset, offset + count), ch * count);
      }
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: ab.sampleRate,
        numberOfFrames: count,
        numberOfChannels: numCh,
        timestamp: Math.round((offset / ab.sampleRate) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
    }
    await audioEncoder.flush();
    audioEncoder.close();
  }

  // Render deterministic 60fps frames (compositing WebGL + top-left HUD if provided)
  const dt = 1 / fps;
  const offsetSec = options.latencyOffsetMs / 1000;
  const analyzer = new AudioAnalyzer();
  frameStore.resetPrevTime(-1);

  const compCanvas = options.drawHudOverlay ? document.createElement('canvas') : null;
  if (compCanvas) {
    compCanvas.width = width;
    compCanvas.height = height;
  }
  const compCtx = compCanvas ? compCanvas.getContext('2d') : null;

  for (let f = 0; f < totalFrames; f++) {
    if (options.signal?.aborted) {
      videoEncoder.close();
      throw new Error('Export cancelled');
    }
    if (encoderError) throw encoderError;

    const audioTime = f * dt;
    const visualTime = Math.max(0, audioTime + offsetSec);
    const frameState = frameStore.evaluate(visualTime, true);
    const analysis = analyzer.analyze(options.audioBuffer, audioTime, true, dt);
    scene.renderFrame(frameState, dt, analysis);

    let frameSource: HTMLCanvasElement = canvas;
    if (compCanvas && compCtx && options.drawHudOverlay) {
      compCtx.clearRect(0, 0, width, height);
      compCtx.drawImage(canvas, 0, 0, width, height);
      options.drawHudOverlay(compCtx, frameState, options.durationSec);
      frameSource = compCanvas;
    }

    const timestampUs = f * frameDurationUs;
    const vFrame = new VideoFrame(frameSource, {
      timestamp: timestampUs,
      duration: frameDurationUs,
    });

    while (videoEncoder.encodeQueueSize > 8) {
      await new Promise((r) => setTimeout(r, 4));
    }

    videoEncoder.encode(vFrame, { keyFrame: f % (fps * 2) === 0 });
    vFrame.close();

    if (f % 10 === 0 || f === totalFrames - 1) {
      options.onProgress?.((f + 1) / totalFrames, `Rendering frame ${f + 1} / ${totalFrames}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();

  return {
    blob: new Blob([target.buffer], { type: mimeType }),
    extension,
  };
}
