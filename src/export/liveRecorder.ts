export interface LiveExportOptions {
  transparent: boolean;
  videoBitsPerSecond?: number;
}

export class LiveRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = 'video/webm';

  public isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  public start(
    canvas: HTMLCanvasElement,
    audioTrack: MediaStreamTrack | null,
    options: LiveExportOptions
  ): void {
    if (this.isRecording()) return;

    const canvasStream = canvas.captureStream(60);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    if (audioTrack) {
      tracks.push(audioTrack);
    }
    const combined = new MediaStream(tracks);

    const candidates = options.transparent
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm']
      : [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ];

    this.mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    this.chunks = [];

    this.recorder = new MediaRecorder(combined, {
      mimeType: this.mimeType,
      videoBitsPerSecond: options.videoBitsPerSecond ?? 14_000_000,
    });

    this.recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
      }
    };

    this.recorder.start(250);
  }

  public stop(): Promise<{ blob: Blob; extension: string }> {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        reject(new Error('Recorder is not active.'));
        return;
      }

      const rec = this.recorder;
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        const ext = this.mimeType.includes('mp4') ? 'mp4' : 'webm';
        this.chunks = [];
        this.recorder = null;
        resolve({ blob, extension: ext });
      };
      rec.onerror = () => {
        reject(new Error('MediaRecorder encountered an error.'));
      };
      rec.stop();
    });
  }
}
