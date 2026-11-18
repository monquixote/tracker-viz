import type {
  BackdropMode,
  CameraPreset,
  CompiledTimeline,
  FrameState,
  LaneMode,
  PatternDisplayMode,
} from '../types/timeline.ts';
import type { MidiInputInfo } from '../audio/midiClockAdapter.ts';
import type { OfflineFormat } from '../export/offlineExporter.ts';
import type { ProjectCandidate } from '../tracker/projectDiscovery.ts';

export interface AppShellCallbacks {
  onMountDrive: () => void;
  onBrowseProjects: () => void;
  onLoadLatest: () => void;
  onFolderFilesSelected: (files: FileList) => void;
  onWavSelected: (file: File) => void;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (timeSec: number) => void;
  onLatencyChange: (ms: number) => void;
  onAutoAlign: () => void;
  onLaneModeChange: (mode: LaneMode) => void;
  onCameraChange: (preset: CameraPreset) => void;
  onBackdropChange: (mode: BackdropMode) => void;
  onPatternDisplayChange: (mode: PatternDisplayMode) => void;
  onEditPatternNames: () => void;
  onToggleMidiSync: () => void;
  onMidiInputChange: (id: string) => void;
  onTransparentChange: (transparent: boolean) => void;
  onToggleLiveRecord: () => void;
  onOfflineExport: (format: OfflineFormat) => void;
  onCancelOfflineExport: () => void;
}

export class AppShell {
  public readonly root: HTMLElement;
  public readonly viewportEl: HTMLElement;

  private playBtn: HTMLButtonElement;
  private scrubber: HTMLInputElement;
  private songRowsStrip: HTMLElement;
  private rowButtons: HTMLButtonElement[] = [];

  private latencySlider: HTMLInputElement;
  private latencyLabel: HTMLElement;

  private liveRecBtn: HTMLButtonElement;
  private midiSyncBtn: HTMLButtonElement;
  private midiInputSelect: HTMLSelectElement;
  private offlineMp4Btn: HTMLButtonElement;
  private offlineWebmBtn: HTMLButtonElement;

  private toastEl: HTMLElement;
  private toastTextEl: HTMLElement;
  private progressWrapEl: HTMLElement;
  private progressFillEl: HTMLElement;
  private cancelExportBtn: HTMLButtonElement;

  private isScrubbing = false;
  private callbacks: AppShellCallbacks;

  constructor(callbacks: AppShellCallbacks) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'app-layout';

    this.root.innerHTML = `
      <div class="viewport" data-role="viewport"></div>
      <button class="restore-ui-btn" data-role="restore-ui" title="Show controls (H)">SHOW UI (H)</button>
      <div class="control-dock">
        <div class="song-rows-strip" data-role="song-rows"></div>
        <div class="dock-row">
          <button class="btn btn-primary" data-role="play-btn">▶ PLAY</button>
          <button class="btn" data-role="stop-btn">■ STOP</button>
          <input class="scrubber" type="range" min="0" max="100" step="0.01" value="0" data-role="scrubber" />

          <div class="control-group">
            <span>OFFSET</span>
            <input type="range" min="-300" max="300" step="1" value="0" data-role="latency" style="width:90px" />
            <span data-role="latency-val">0ms</span>
            <button class="btn" data-role="auto-align" title="Detect first audio transient">AUTO</button>
          </div>
        </div>

        <div class="dock-row">
          <button class="btn btn-primary" data-role="mount-drive">MOUNT TRACKER</button>
          <button class="btn" data-role="browse-projects">PROJECTS</button>
          <button class="btn" data-role="load-latest">LOAD LATEST</button>
          <button class="btn" data-role="pick-folder">OPEN FOLDER</button>
          <button class="btn" data-role="pick-wav">LOAD WAV</button>

          <div class="control-group">
            <span>LANES</span>
            <select data-role="lane-mode">
              <option value="auto" selected>Auto</option>
              <option value="8">8</option>
              <option value="12">12</option>
              <option value="16">16</option>
            </select>
          </div>

          <div class="control-group">
            <span>CAM</span>
            <select data-role="camera">
              <option value="classic" selected>Classic</option>
              <option value="low">Low Action</option>
              <option value="top">Top-Down</option>
              <option value="side">Side Sweep</option>
            </select>
          </div>

          <div class="control-group">
            <span>BACKDROP</span>
            <select data-role="backdrop-mode">
              <option value="outrun" selected>Outrun Sun</option>
              <option value="waterfall">Joy Division</option>
              <option value="demoscene">Demoscene</option>
              <option value="hyperspace">Hyperspace</option>
              <option value="oscilloscope">Oscilloscope</option>
              <option value="plasma">Plasma Cloud</option>
              <option value="none">None</option>
            </select>
          </div>

          <div class="control-group">
            <span>SECTIONS</span>
            <select data-role="pattern-display">
              <option value="gantries" selected>Gantries</option>
              <option value="marquee">Fly-Through Laser</option>
              <option value="chromatic">Chromatic Slam</option>
              <option value="none">None</option>
            </select>
          </div>

          <button class="btn" data-role="edit-names" title="Edit pattern names">NAMES</button>
          <button class="btn" data-role="midi-sync" title="Sync to Polyend Tracker Web MIDI Start/Clock">MIDI SYNC</button>
          <select data-role="midi-input" style="display:none;max-width:140px"></select>

          <label class="control-group" style="cursor:pointer">
            <input type="checkbox" data-role="transparent-bg" />
            <span>ALPHA</span>
          </label>

          <button class="btn" data-role="hide-ui" title="Hide UI to preview render (H)">HIDE UI</button>
          <button class="btn btn-danger" data-role="live-rec">● LIVE REC</button>
          <button class="btn" data-role="export-mp4">EXPORT MP4</button>
          <button class="btn" data-role="export-webm">EXPORT WEBM</button>
        </div>
      </div>

      <div class="status-toast" data-role="toast">
        <div data-role="toast-text">Loading...</div>
        <div class="progress-bar-wrap" data-role="progress-wrap" style="display:none">
          <div class="progress-bar-fill" data-role="progress-fill"></div>
        </div>
        <div style="margin-top:10px">
          <button class="btn btn-danger" data-role="cancel-export" style="display:none">CANCEL</button>
        </div>
      </div>

      <div class="modal-backdrop" data-role="project-modal">
        <div class="modal-card">
          <div class="modal-header">
            <span>SELECT TRACKER PROJECT</span>
            <button class="btn" data-role="close-modal">✕</button>
          </div>
          <div class="control-group" style="justify-content:space-between">
            <span>MASTER WAV (/Export)</span>
            <select data-role="modal-wav-select" style="max-width:340px"></select>
          </div>
          <div class="project-list" data-role="project-list"></div>
        </div>
      </div>

      <div class="modal-backdrop" data-role="names-modal">
        <div class="modal-card">
          <div class="modal-header">
            <span>EDIT TRACK &amp; PATTERN NAMES</span>
            <button class="btn" data-role="close-names-modal">✕</button>
          </div>
          <div class="project-list" data-role="names-list"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
            <button class="btn" data-role="cancel-names">CANCEL</button>
            <button class="btn btn-primary" data-role="save-names">APPLY</button>
          </div>
        </div>
      </div>

      <input type="file" webkitdirectory directory multiple style="display:none" data-role="folder-input" />
      <input type="file" accept=".wav,audio/wav" style="display:none" data-role="wav-input" />
    `;

    this.playBtn = this.root.querySelector('[data-role="play-btn"]')!;
    this.viewportEl = this.root.querySelector('[data-role="viewport"]')!;
    this.scrubber = this.root.querySelector('[data-role="scrubber"]')!;
    this.songRowsStrip = this.root.querySelector('[data-role="song-rows"]')!;
    this.latencySlider = this.root.querySelector('[data-role="latency"]')!;
    this.latencyLabel = this.root.querySelector('[data-role="latency-val"]')!;
    this.liveRecBtn = this.root.querySelector('[data-role="live-rec"]')!;
    this.midiSyncBtn = this.root.querySelector('[data-role="midi-sync"]')!;
    this.midiInputSelect = this.root.querySelector('[data-role="midi-input"]')!;
    this.offlineMp4Btn = this.root.querySelector('[data-role="export-mp4"]')!;
    this.offlineWebmBtn = this.root.querySelector('[data-role="export-webm"]')!;

    this.toastEl = this.root.querySelector('[data-role="toast"]')!;
    this.toastTextEl = this.root.querySelector('[data-role="toast-text"]')!;
    this.progressWrapEl = this.root.querySelector('[data-role="progress-wrap"]')!;
    this.progressFillEl = this.root.querySelector('[data-role="progress-fill"]')!;
    this.cancelExportBtn = this.root.querySelector('[data-role="cancel-export"]')!;

    const folderInput = this.root.querySelector<HTMLInputElement>('[data-role="folder-input"]')!;
    const wavInput = this.root.querySelector<HTMLInputElement>('[data-role="wav-input"]')!;

    this.playBtn.addEventListener('click', () => this.callbacks.onPlayPause());
    this.root.querySelector('[data-role="stop-btn"]')!.addEventListener('click', () =>
      this.callbacks.onStop()
    );

    this.scrubber.addEventListener('pointerdown', () => {
      this.isScrubbing = true;
    });
    this.scrubber.addEventListener('input', () => {
      this.callbacks.onSeek(Number(this.scrubber.value));
    });
    window.addEventListener('pointerup', () => {
      this.isScrubbing = false;
    });

    this.latencySlider.addEventListener('input', () => {
      const val = Number(this.latencySlider.value);
      this.latencyLabel.textContent = `${val}ms`;
      this.callbacks.onLatencyChange(val);
    });

    this.root.querySelector('[data-role="auto-align"]')!.addEventListener('click', () =>
      this.callbacks.onAutoAlign()
    );
    this.root.querySelector('[data-role="mount-drive"]')!.addEventListener('click', () =>
      this.callbacks.onMountDrive()
    );
    this.root.querySelector('[data-role="browse-projects"]')!.addEventListener('click', () =>
      this.callbacks.onBrowseProjects()
    );
    this.root.querySelector('[data-role="load-latest"]')!.addEventListener('click', () =>
      this.callbacks.onLoadLatest()
    );
    this.root.querySelector('[data-role="close-modal"]')!.addEventListener('click', () =>
      this.hideProjectPicker()
    );
    this.root.querySelector('[data-role="pick-folder"]')!.addEventListener('click', () =>
      folderInput.click()
    );
    this.root.querySelector('[data-role="pick-wav"]')!.addEventListener('click', () =>
      wavInput.click()
    );

    folderInput.addEventListener('change', () => {
      if (folderInput.files && folderInput.files.length > 0) {
        this.callbacks.onFolderFilesSelected(folderInput.files);
      }
      folderInput.value = '';
    });

    wavInput.addEventListener('change', () => {
      const f = wavInput.files?.[0];
      if (f) this.callbacks.onWavSelected(f);
      wavInput.value = '';
    });

    this.root.querySelector<HTMLSelectElement>('[data-role="lane-mode"]')!.addEventListener(
      'change',
      (e) => {
        const val = (e.target as HTMLSelectElement).value;
        this.callbacks.onLaneModeChange(val === 'auto' ? 'auto' : (Number(val) as 8 | 12 | 16));
      }
    );

    this.root.querySelector<HTMLSelectElement>('[data-role="camera"]')!.addEventListener(
      'change',
      (e) => {
        this.callbacks.onCameraChange((e.target as HTMLSelectElement).value as CameraPreset);
      }
    );

    this.root.querySelector<HTMLSelectElement>('[data-role="backdrop-mode"]')!.addEventListener(
      'change',
      (e) => {
        this.callbacks.onBackdropChange((e.target as HTMLSelectElement).value as BackdropMode);
      }
    );

    this.root.querySelector<HTMLSelectElement>('[data-role="pattern-display"]')!.addEventListener(
      'change',
      (e) => {
        this.callbacks.onPatternDisplayChange(
          (e.target as HTMLSelectElement).value as PatternDisplayMode
        );
      }
    );

    this.root.querySelector('[data-role="edit-names"]')!.addEventListener('click', () =>
      this.callbacks.onEditPatternNames()
    );
    this.midiSyncBtn.addEventListener('click', () => this.callbacks.onToggleMidiSync());
    this.midiInputSelect.addEventListener('change', () =>
      this.callbacks.onMidiInputChange(this.midiInputSelect.value)
    );

    this.root.querySelector('[data-role="close-names-modal"]')!.addEventListener('click', () =>
      this.hidePatternNamesEditor()
    );
    this.root.querySelector('[data-role="cancel-names"]')!.addEventListener('click', () =>
      this.hidePatternNamesEditor()
    );

    this.root.querySelector<HTMLInputElement>('[data-role="transparent-bg"]')!.addEventListener(
      'change',
      (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.viewportEl.classList.toggle('transparent-preview', checked);
        this.callbacks.onTransparentChange(checked);
      }
    );

    this.root.querySelector('[data-role="hide-ui"]')!.addEventListener('click', () =>
      this.setCleanView(true)
    );
    this.root.querySelector('[data-role="restore-ui"]')!.addEventListener('click', () =>
      this.setCleanView(false)
    );
    this.liveRecBtn.addEventListener('click', () => this.callbacks.onToggleLiveRecord());
    this.offlineMp4Btn.addEventListener('click', () => this.callbacks.onOfflineExport('mp4'));
    this.offlineWebmBtn.addEventListener('click', () => this.callbacks.onOfflineExport('webm'));
    this.cancelExportBtn.addEventListener('click', () => this.callbacks.onCancelOfflineExport());
  }

  public setTimeline(timeline: CompiledTimeline | null): void {
    this.scrubber.max = String(Math.max(1, timeline?.totalDurationSec ?? 1));
    this.scrubber.value = '0';

    this.songRowsStrip.innerHTML = '';
    this.rowButtons = [];

    if (!timeline) return;
    for (const row of timeline.songRows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'row-pill';
      btn.textContent = `R${String(row.songRow + 1).padStart(2, '0')} · ${row.patternName.slice(0, 10)}`;
      btn.addEventListener('click', () => this.callbacks.onSeek(row.startTimeSec));
      this.songRowsStrip.appendChild(btn);
      this.rowButtons.push(btn);
    }
  }

  public setLatencyOffsetMs(ms: number): void {
    const rounded = Math.round(ms);
    this.latencySlider.value = String(rounded);
    this.latencyLabel.textContent = `${rounded}ms`;
  }

  public setRecordingState(recording: boolean): void {
    this.liveRecBtn.classList.toggle('btn-record-active', recording);
    this.liveRecBtn.textContent = recording ? '■ STOP REC' : '● LIVE REC';
  }

  public setMidiSyncState(enabled: boolean, inputs: MidiInputInfo[]): void {
    this.midiSyncBtn.classList.toggle('btn-primary', enabled);
    this.midiSyncBtn.textContent = enabled ? 'MIDI: ON' : 'MIDI SYNC';
    this.midiInputSelect.style.display = enabled ? 'inline-block' : 'none';

    if (enabled) {
      const prev = this.midiInputSelect.value;
      this.midiInputSelect.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = '__all__';
      allOpt.textContent = 'All MIDI Inputs';
      this.midiInputSelect.appendChild(allOpt);

      for (const inp of inputs) {
        const opt = document.createElement('option');
        opt.value = inp.id;
        opt.textContent = inp.name;
        this.midiInputSelect.appendChild(opt);
      }
      if (prev && Array.from(this.midiInputSelect.options).some((o) => o.value === prev)) {
        this.midiInputSelect.value = prev;
      }
    }
  }

  public update(frame: FrameState): void {
    this.playBtn.textContent = frame.isPlaying ? '❚❚ PAUSE' : '▶ PLAY';
    if (!this.isScrubbing) {
      this.scrubber.value = String(frame.timeSec);
    }
    for (let i = 0; i < this.rowButtons.length; i++) {
      this.rowButtons[i]!.classList.toggle('active', i === frame.songRow);
    }
  }

  public showToast(message: string, progress01?: number, showCancel = false): void {
    this.toastEl.classList.add('visible');
    this.toastTextEl.textContent = message;
    if (progress01 !== undefined) {
      this.progressWrapEl.style.display = 'block';
      this.progressFillEl.style.width = `${Math.round(progress01 * 100)}%`;
    } else {
      this.progressWrapEl.style.display = 'none';
    }
    this.cancelExportBtn.style.display = showCancel ? 'inline-block' : 'none';
  }

  public hideToast(): void {
    this.toastEl.classList.remove('visible');
  }

  public showProjectPicker(
    projects: ProjectCandidate[],
    wavs: Array<{ name: string; file: File }>,
    onPick: (project: ProjectCandidate, wavFile: File | null) => void
  ): void {
    const modal = this.root.querySelector<HTMLElement>('[data-role="project-modal"]')!;
    const listEl = this.root.querySelector<HTMLElement>('[data-role="project-list"]')!;
    const wavSelect = this.root.querySelector<HTMLSelectElement>('[data-role="modal-wav-select"]')!;

    wavSelect.innerHTML = '';
    const autoOpt = document.createElement('option');
    autoOpt.value = '__auto__';
    autoOpt.textContent = 'Auto-match by project name';
    wavSelect.appendChild(autoOpt);

    const noneOpt = document.createElement('option');
    noneOpt.value = '__none__';
    noneOpt.textContent = 'No WAV (visuals only)';
    wavSelect.appendChild(noneOpt);

    wavs.forEach((w, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = w.name;
      wavSelect.appendChild(opt);
    });

    listEl.innerHTML = '';
    for (const proj of projects) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'project-item';
      const dateStr = proj.lastModified
        ? new Date(proj.lastModified).toLocaleDateString()
        : '';
      btn.innerHTML = `<span>${proj.relativePath}</span><span class="project-date">${dateStr}</span>`;
      btn.addEventListener('click', () => {
        this.hideProjectPicker();
        let chosenWav: File | null = null;
        if (wavSelect.value === '__auto__') {
          const lower = proj.name.toLowerCase();
          chosenWav =
            wavs.find((w) => w.name.toLowerCase().includes(lower))?.file ??
            wavs[0]?.file ??
            null;
        } else if (wavSelect.value !== '__none__') {
          chosenWav = wavs[Number(wavSelect.value)]?.file ?? null;
        }
        onPick(proj, chosenWav);
      });
      listEl.appendChild(btn);
    }

    modal.classList.add('visible');
  }

  public hideProjectPicker(): void {
    this.root.querySelector('[data-role="project-modal"]')?.classList.remove('visible');
  }

  public setCleanView(hidden: boolean): void {
    this.root.classList.toggle('ui-hidden', hidden);
  }

  public toggleCleanView(): void {
    this.root.classList.toggle('ui-hidden');
  }

  public showNamesEditor(
    tracks: Array<{ trackIndex: number; name: string; colorHex: string }>,
    patterns: Array<{ patternIndex: number; name: string }>,
    onSave: (updatedTracks: Map<number, string>, updatedPatterns: Map<number, string>) => void
  ): void {
    const modal = this.root.querySelector<HTMLElement>('[data-role="names-modal"]')!;
    const listEl = this.root.querySelector<HTMLElement>('[data-role="names-list"]')!;
    const saveBtn = this.root.querySelector<HTMLButtonElement>('[data-role="save-names"]')!;

    listEl.innerHTML = '';
    const trackInputs = new Map<number, HTMLInputElement>();
    const patternInputs = new Map<number, HTMLInputElement>();

    const makeSectionHeader = (title: string) => {
      const h = document.createElement('div');
      h.style.cssText =
        'font-family:var(--mono);font-size:10px;letter-spacing:0.1em;color:var(--muted);margin:6px 0 2px';
      h.textContent = title;
      listEl.appendChild(h);
    };

    if (tracks.length > 0) {
      makeSectionHeader('TRACKS');
      for (const trk of tracks) {
        const row = document.createElement('div');
        row.className = 'name-row';

        const lbl = document.createElement('span');
        lbl.className = 'name-row-label';
        lbl.style.color = trk.colorHex;
        lbl.textContent = `TRK ${String(trk.trackIndex + 1).padStart(2, '0')}`;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'name-row-input';
        input.maxLength = 16;
        input.value = trk.name;
        input.placeholder = `Track ${trk.trackIndex + 1}`;

        row.append(lbl, input);
        listEl.appendChild(row);
        trackInputs.set(trk.trackIndex, input);
      }
    }

    if (patterns.length > 0) {
      makeSectionHeader('PATTERNS');
      for (const entry of patterns) {
        const row = document.createElement('div');
        row.className = 'name-row';

        const lbl = document.createElement('span');
        lbl.className = 'name-row-label';
        lbl.textContent = `PAT ${String(entry.patternIndex).padStart(2, '0')}`;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'name-row-input';
        input.maxLength = 30;
        input.value = entry.name;
        input.placeholder = `Pattern ${entry.patternIndex} name (e.g. INTRO, DROP)`;

        row.append(lbl, input);
        listEl.appendChild(row);
        patternInputs.set(entry.patternIndex, input);
      }
    }

    saveBtn.onclick = () => {
      const updatedTracks = new Map<number, string>();
      for (const [trkIdx, inp] of trackInputs.entries()) {
        const val = inp.value.trim();
        updatedTracks.set(trkIdx, val || `TRK ${String(trkIdx + 1).padStart(2, '0')}`);
      }
      const updatedPatterns = new Map<number, string>();
      for (const [patIdx, inp] of patternInputs.entries()) {
        const val = inp.value.trim();
        updatedPatterns.set(patIdx, val || `PAT ${String(patIdx).padStart(2, '0')}`);
      }
      this.hidePatternNamesEditor();
      onSave(updatedTracks, updatedPatterns);
    };

    modal.classList.add('visible');
  }

  public hidePatternNamesEditor(): void {
    this.root.querySelector('[data-role="names-modal"]')?.classList.remove('visible');
  }
}
