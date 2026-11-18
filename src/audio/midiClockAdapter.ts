export interface MidiInputInfo {
  id: string;
  name: string;
}

export interface MidiSyncSnapshot {
  connected: boolean;
  isPlaying: boolean;
  tickCount: number;
  gridStepFloat: number;
  measuredBpm: number;
}

export class MidiClockAdapter {
  private access: MIDIAccess | null = null;
  private selectedInputId: string = '__all__';
  private enabled = false;

  private isPlayingState = false;
  private tickCount = 0;
  private lastTickPerfMs = 0;
  private smoothedTickMs = 500 / 24; // default ~120 BPM
  private measuredBpm = 120;

  private onInputsChanged?: (inputs: MidiInputInfo[]) => void;
  private onTransportEvent?: (type: 'start' | 'continue' | 'stop') => void;

  constructor(callbacks?: {
    onInputsChanged?: (inputs: MidiInputInfo[]) => void;
    onTransportEvent?: (type: 'start' | 'continue' | 'stop') => void;
  }) {
    this.onInputsChanged = callbacks?.onInputsChanged;
    this.onTransportEvent = callbacks?.onTransportEvent;
  }

  public static isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  public async connect(): Promise<MidiInputInfo[]> {
    if (!MidiClockAdapter.isSupported()) {
      throw new Error('Web MIDI API is not supported in this browser (use Chrome/Edge).');
    }
    if (!this.access) {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        this.bindInputs();
        this.onInputsChanged?.(this.getInputs());
      };
    }
    this.enabled = true;
    this.bindInputs();
    return this.getInputs();
  }

  public disconnect(): void {
    this.enabled = false;
    this.isPlayingState = false;
    if (this.access) {
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = null;
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getInputs(): MidiInputInfo[] {
    if (!this.access) return [];
    const list: MidiInputInfo[] = [];
    for (const input of this.access.inputs.values()) {
      list.push({ id: input.id, name: input.name || 'MIDI Input' });
    }
    return list;
  }

  public setSelectedInput(id: string): void {
    this.selectedInputId = id;
    this.bindInputs();
  }

  public reset(): void {
    this.isPlayingState = false;
    this.tickCount = 0;
    this.lastTickPerfMs = 0;
  }

  private bindInputs(): void {
    if (!this.access || !this.enabled) return;
    for (const input of this.access.inputs.values()) {
      const shouldListen =
        this.selectedInputId === '__all__' || input.id === this.selectedInputId;
      input.onmidimessage = shouldListen ? (ev) => this.handleMidiMessage(ev) : null;
    }
  }

  private handleMidiMessage(ev: MIDIMessageEvent): void {
    const data = ev.data;
    if (!data || data.length === 0) return;
    const status = data[0]!;

    if (status === 0xfa) {
      // MIDI Start -> reset to Song Row 0, Step 0
      this.tickCount = 0;
      this.lastTickPerfMs = performance.now();
      this.isPlayingState = true;
      this.onTransportEvent?.('start');
    } else if (status === 0xfb) {
      // MIDI Continue
      this.lastTickPerfMs = performance.now();
      this.isPlayingState = true;
      this.onTransportEvent?.('continue');
    } else if (status === 0xfc) {
      // MIDI Stop
      this.isPlayingState = false;
      this.onTransportEvent?.('stop');
    } else if (status === 0xf8) {
      // MIDI Clock (24 PPQN -> 6 ticks per 16th-note Tracker step)
      const now = performance.now();
      if (this.lastTickPerfMs > 0) {
        const dtMs = now - this.lastTickPerfMs;
        if (dtMs > 3 && dtMs < 250) {
          this.smoothedTickMs = this.smoothedTickMs * 0.85 + dtMs * 0.15;
          this.measuredBpm = 60_000 / (this.smoothedTickMs * 24);
        }
      }
      this.lastTickPerfMs = now;
      if (this.isPlayingState) {
        this.tickCount++;
      }
    }
  }

  public getSnapshot(latencyOffsetMs = 0): MidiSyncSnapshot {
    let subTick = 0;
    if (this.isPlayingState && this.lastTickPerfMs > 0 && this.smoothedTickMs > 0) {
      const elapsedMs = performance.now() - this.lastTickPerfMs + latencyOffsetMs;
      subTick = Math.max(-2, Math.min(1.5, elapsedMs / this.smoothedTickMs));
    }
    const gridStepFloat = Math.max(0, (this.tickCount + subTick) / 6);

    return {
      connected: this.enabled && this.access !== null,
      isPlaying: this.isPlayingState,
      tickCount: this.tickCount,
      gridStepFloat,
      measuredBpm: this.measuredBpm,
    };
  }
}
