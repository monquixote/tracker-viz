export interface AudioAnalysisFrame {
  rms: number;
  bass: number;
  mid: number;
  high: number;
  bands: Float32Array;
  waveL: Float32Array;
  waveR: Float32Array;
}

const FFT_SIZE = 512;
const BAND_COUNT = 20;
const WAVE_POINTS = 128;

export class AudioAnalyzer {
  private cosTable = new Float32Array(FFT_SIZE / 2);
  private sinTable = new Float32Array(FFT_SIZE / 2);
  private hannWindow = new Float32Array(FFT_SIZE);
  private real = new Float32Array(FFT_SIZE);
  private imag = new Float32Array(FFT_SIZE);

  private smoothedBands = new Float32Array(BAND_COUNT);
  private waveL = new Float32Array(WAVE_POINTS);
  private waveR = new Float32Array(WAVE_POINTS);
  private smoothedRms = 0;
  private smoothedBass = 0;
  private smoothedMid = 0;
  private smoothedHigh = 0;

  constructor() {
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      const angle = (-2 * Math.PI * i) / FFT_SIZE;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
    for (let i = 0; i < FFT_SIZE; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }
  }

  public reset(): void {
    this.smoothedBands.fill(0);
    this.waveL.fill(0);
    this.waveR.fill(0);
    this.smoothedRms = 0;
    this.smoothedBass = 0;
    this.smoothedMid = 0;
    this.smoothedHigh = 0;
  }

  public analyze(
    buffer: AudioBuffer | null,
    timeSec: number,
    isPlaying: boolean,
    dt: number
  ): AudioAnalysisFrame {
    const release = 1 - Math.exp(-dt * 4.5);
    const attack = 1 - Math.exp(-dt * 12.0);

    if (!buffer || !isPlaying || timeSec < 0 || timeSec >= buffer.duration) {
      this.smoothedRms += (0 - this.smoothedRms) * release;
      this.smoothedBass += (0 - this.smoothedBass) * release;
      this.smoothedMid += (0 - this.smoothedMid) * release;
      this.smoothedHigh += (0 - this.smoothedHigh) * release;
      for (let i = 0; i < BAND_COUNT; i++) {
        const curr = this.smoothedBands[i] ?? 0;
        this.smoothedBands[i] = curr + (0 - curr) * release;
      }
      for (let i = 0; i < WAVE_POINTS; i++) {
        this.waveL[i] = (this.waveL[i] ?? 0) * (1 - release);
        this.waveR[i] = (this.waveR[i] ?? 0) * (1 - release);
      }
      return {
        rms: this.smoothedRms,
        bass: this.smoothedBass,
        mid: this.smoothedMid,
        high: this.smoothedHigh,
        bands: this.smoothedBands,
        waveL: this.waveL,
        waveR: this.waveR,
      };
    }

    const sr = buffer.sampleRate;
    const centerSample = Math.floor(timeSec * sr);
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

    // Wider ~35ms RMS window + centered 512-sample Hann FFT to eliminate phase jitter
    const rmsWindow = 1536;
    const rmsStart = Math.max(0, centerSample - rmsWindow / 2);
    let sumSq = 0;
    for (let i = 0; i < rmsWindow; i++) {
      const idx = rmsStart + i;
      if (idx >= ch0.length) break;
      const s = ch1 ? ((ch0[idx] ?? 0) + (ch1[idx] ?? 0)) * 0.5 : (ch0[idx] ?? 0);
      sumSq += s * s;
    }

    const startSample = Math.max(0, centerSample - FFT_SIZE / 2);
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = startSample + i;
      let s = 0;
      if (idx < ch0.length) {
        s = ch1 ? ((ch0[idx] ?? 0) + (ch1[idx] ?? 0)) * 0.5 : (ch0[idx] ?? 0);
      }
      this.real[i] = s * (this.hannWindow[i] ?? 1);
      this.imag[i] = 0;
    }

    const rawRms = Math.min(1, Math.sqrt(sumSq / rmsWindow) * 2.5);
    const rmsLerp = rawRms > this.smoothedRms ? attack : release;
    this.smoothedRms += (rawRms - this.smoothedRms) * rmsLerp;

    // In-place radix-2 Cooley-Tukey FFT
    this.fft(this.real, this.imag);

    const binHz = sr / FFT_SIZE;
    const halfBins = FFT_SIZE / 2;

    // Aggregate bass / mid / high
    let bassSum = 0;
    let bassCount = 0;
    let midSum = 0;
    let midCount = 0;
    let highSum = 0;
    let highCount = 0;

    for (let b = 1; b < halfBins; b++) {
      const re = this.real[b]!;
      const im = this.imag[b]!;
      const mag = Math.sqrt(re * re + im * im) / (FFT_SIZE * 0.25);
      const freq = b * binHz;
      if (freq <= 180) {
        bassSum += mag;
        bassCount++;
      } else if (freq <= 2200) {
        midSum += mag;
        midCount++;
      } else if (freq <= 12000) {
        highSum += mag;
        highCount++;
      }
    }

    const rawBass = Math.min(1, (bassSum / Math.max(1, bassCount)) * 1.4);
    const rawMid = Math.min(1, (midSum / Math.max(1, midCount)) * 2.4);
    const rawHigh = Math.min(1, (highSum / Math.max(1, highCount)) * 4.5);

    this.smoothedBass += (rawBass - this.smoothedBass) * (rawBass > this.smoothedBass ? attack : release);
    this.smoothedMid += (rawMid - this.smoothedMid) * (rawMid > this.smoothedMid ? attack : release);
    this.smoothedHigh += (rawHigh - this.smoothedHigh) * (rawHigh > this.smoothedHigh ? attack : release);

    // 20 log-spaced spectrum bands (40 Hz .. 12 kHz)
    const minFreq = 40;
    const maxFreq = 12000;
    const ratio = maxFreq / minFreq;

    for (let band = 0; band < BAND_COUNT; band++) {
      const f0 = minFreq * Math.pow(ratio, band / BAND_COUNT);
      const f1 = minFreq * Math.pow(ratio, (band + 1) / BAND_COUNT);
      const b0 = Math.max(1, Math.floor(f0 / binHz));
      const b1 = Math.min(halfBins - 1, Math.max(b0, Math.ceil(f1 / binHz)));

      let peak = 0;
      for (let b = b0; b <= b1; b++) {
        const re = this.real[b]!;
        const im = this.imag[b]!;
        const mag = Math.sqrt(re * re + im * im) / (FFT_SIZE * 0.22);
        if (mag > peak) peak = mag;
      }

      // Gentle high-frequency tilt compensation + log compression
      const tilt = 1 + (band / BAND_COUNT) * 2.2;
      const val = Math.min(1, Math.pow(Math.min(1, peak * tilt), 0.72));
      const prev = this.smoothedBands[band] ?? 0;
      const k = val > prev ? attack : release;
      this.smoothedBands[band] = prev + (val - prev) * k;
    }

    const waveStride = 4; // ~11ms stereo oscilloscope window with rising-edge zero-crossing trigger
    const searchWindow = 512;
    let triggerSample = Math.max(1, centerSample - (WAVE_POINTS * waveStride) / 2);
    const searchEnd = Math.min(ch0.length - 1, triggerSample + searchWindow);
    for (let s = triggerSample; s < searchEnd; s++) {
      if ((ch0[s - 1] ?? 0) <= 0 && (ch0[s] ?? 0) > 0) {
        triggerSample = s;
        break;
      }
    }

    for (let i = 0; i < WAVE_POINTS; i++) {
      const idx = triggerSample + i * waveStride;
      if (idx > 0 && idx + 1 < ch0.length) {
        // Gentle 3-tap spatial smoothing so CRT ribbon looks liquid and non-jagged
        const l = ((ch0[idx - 1] ?? 0) + (ch0[idx] ?? 0) * 2 + (ch0[idx + 1] ?? 0)) * 0.25;
        const r = ch1
          ? ((ch1[idx - 1] ?? 0) + (ch1[idx] ?? 0) * 2 + (ch1[idx + 1] ?? 0)) * 0.25
          : l;
        this.waveL[i] = l;
        this.waveR[i] = r;
      } else {
        this.waveL[i] = 0;
        this.waveR[i] = 0;
      }
    }

    return {
      rms: this.smoothedRms,
      bass: this.smoothedBass,
      mid: this.smoothedMid,
      high: this.smoothedHigh,
      bands: this.smoothedBands,
      waveL: this.waveL,
      waveR: this.waveR,
    };
  }

  private fft(real: Float32Array, imag: Float32Array): void {
    const n = real.length;
    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < n; i++) {
      if (i < j) {
        const tr = real[i]!;
        const ti = imag[i]!;
        real[i] = real[j]!;
        imag[i] = imag[j]!;
        real[j] = tr;
        imag[j] = ti;
      }
      let m = n >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }

    // Butterfly passes
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const tableIdx = k * step;
          const wr = this.cosTable[tableIdx]!;
          const wi = this.sinTable[tableIdx]!;
          const evenIdx = i + k;
          const oddIdx = evenIdx + half;
          const or = real[oddIdx]!;
          const oi = imag[oddIdx]!;
          const tr = wr * or - wi * oi;
          const ti = wr * oi + wi * or;
          real[oddIdx] = real[evenIdx]! - tr;
          imag[oddIdx] = imag[evenIdx]! - ti;
          real[evenIdx] = real[evenIdx]! + tr;
          imag[evenIdx] = imag[evenIdx]! + ti;
        }
      }
    }
  }
}
