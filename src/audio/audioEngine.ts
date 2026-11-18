export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;

  private isPlayingState = false;
  private startContextTime = 0;
  private pauseOffsetSec = 0;
  private latencyOffsetMs = 0;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 1.0;
      this.gainNode.connect(this.ctx.destination);
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.gainNode.connect(this.streamDest);
    }
    return this.ctx;
  }

  public setAudioBuffer(buffer: AudioBuffer | null): void {
    this.stop();
    this.buffer = buffer;
    this.pauseOffsetSec = 0;
  }

  public async loadWavFile(file: File): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    const arrayBuf = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    this.setAudioBuffer(decoded);
    return decoded;
  }

  public getAudioBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  public getDurationSec(): number {
    return this.buffer?.duration ?? 0;
  }

  public setLatencyOffsetMs(ms: number): void {
    this.latencyOffsetMs = ms;
  }

  public getLatencyOffsetMs(): number {
    return this.latencyOffsetMs;
  }

  public isPlaying(): boolean {
    return this.isPlayingState;
  }

  public getMediaStreamAudioTrack(): MediaStreamTrack | null {
    this.ensureContext();
    return this.streamDest?.stream.getAudioTracks()[0] ?? null;
  }

  public getCurrentAudioTimeSec(): number {
    if (!this.isPlayingState || !this.ctx) {
      return this.pauseOffsetSec;
    }
    const elapsed = this.ctx.currentTime - this.startContextTime;
    const dur = this.buffer?.duration ?? Infinity;
    if (elapsed >= dur) {
      return dur;
    }
    return Math.max(0, elapsed);
  }

  /** Visual clock = audio time + user latency offset */
  public getVisualTimeSec(): number {
    return Math.max(0, this.getCurrentAudioTimeSec() + this.latencyOffsetMs / 1000);
  }

  public async play(fromSec?: number): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const offset = fromSec !== undefined ? Math.max(0, fromSec) : this.pauseOffsetSec;
    this.stopSourceOnly();

    if (this.buffer) {
      const clampedOffset = Math.min(offset, Math.max(0, this.buffer.duration - 0.01));
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.gainNode!);
      src.onended = () => {
        if (this.source === src && this.isPlayingState) {
          this.isPlayingState = false;
          this.pauseOffsetSec = 0;
          this.source = null;
        }
      };
      this.startContextTime = ctx.currentTime - clampedOffset;
      src.start(0, clampedOffset);
      this.source = src;
      this.pauseOffsetSec = clampedOffset;
    } else {
      // Silent clock mode when no WAV is loaded
      this.startContextTime = ctx.currentTime - offset;
      this.pauseOffsetSec = offset;
    }

    this.isPlayingState = true;
  }

  public pause(): void {
    if (!this.isPlayingState) return;
    this.pauseOffsetSec = this.getCurrentAudioTimeSec();
    this.stopSourceOnly();
    this.isPlayingState = false;
  }

  public stop(): void {
    this.stopSourceOnly();
    this.isPlayingState = false;
    this.pauseOffsetSec = 0;
  }

  public seek(timeSec: number): void {
    const clamped = Math.max(0, timeSec);
    if (this.isPlayingState) {
      void this.play(clamped);
    } else {
      this.pauseOffsetSec = clamped;
    }
  }

  private stopSourceOnly(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
        this.source.disconnect();
      } catch {
        // Ignore already-stopped source
      }
      this.source = null;
    }
  }

  /**
   * Scans the AudioBuffer for the first transient above -50 dBFS
   * to help align exported WAVs with leading silence.
   */
  public detectFirstTransientSec(): number | null {
    if (!this.buffer) return null;
    const threshold = 0.0032; // ~ -50 dBFS
    const channels = this.buffer.numberOfChannels;
    const len = this.buffer.length;
    const sr = this.buffer.sampleRate;

    for (let i = 0; i < len; i++) {
      for (let c = 0; c < channels; c++) {
        const sample = Math.abs(this.buffer.getChannelData(c)[i] ?? 0);
        if (sample >= threshold) {
          return i / sr;
        }
      }
    }
    return 0;
  }
}
