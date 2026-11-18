import { TRACK_HEX_PALETTE } from '../scene/constants.ts';
import type { CompiledTimeline, FrameState, SongRowInfo } from '../types/timeline.ts';

export class HudOverlay {
  public readonly root: HTMLElement;

  private projectTitleEl: HTMLElement;
  private liveDotEl: HTMLElement;
  private songRowEl: HTMLElement;
  private patternEl: HTMLElement;
  private stepEl: HTMLElement;
  private bpmEl: HTMLElement;
  private timeEl: HTMLElement;
  private nextLabelEl: HTMLElement;
  private nextFillEl: HTMLElement;
  private progressFillEl: HTMLElement;
  private muteLedsEl: HTMLElement;

  private muteButtons: HTMLButtonElement[] = [];
  private projectName = 'TRACKER-VIZ';
  private songRows: SongRowInfo[] = [];
  private onToggleMute: (trackIndex: number) => void;

  constructor(onToggleMute: (trackIndex: number) => void) {
    this.onToggleMute = onToggleMute;
    this.root = document.createElement('div');
    this.root.className = 'hud-overlay';

    this.root.innerHTML = `
      <div class="hud-card hud-status-card" data-role="hud-status-card">
        <div class="hud-header-row">
          <div class="hud-title-wrap">
            <span class="hud-live-dot" data-role="live-dot"></span>
            <div class="hud-title" data-role="project-title">TRACKER-VIZ</div>
          </div>
        </div>
        <div class="hud-stats">
          <div class="stat-item">
            <span class="stat-label">SONG ROW</span>
            <span class="stat-value accent" data-role="song-row">01/01</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">PATTERN</span>
            <span class="stat-value" data-role="pattern">---</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">STEP</span>
            <span class="stat-value" data-role="step">000</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">BPM</span>
            <span class="stat-value" data-role="bpm">120</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">TIME</span>
            <span class="stat-value" data-role="time">00:00.0</span>
          </div>
        </div>
        <div class="hud-next-row">
          <span class="hud-next-label" data-role="next-label">NEXT → ---</span>
          <div class="hud-next-track">
            <div class="hud-next-fill" data-role="hud-next-fill"></div>
          </div>
        </div>
        <div class="hud-progress-track">
          <div class="hud-progress-fill" data-role="hud-progress-fill"></div>
        </div>
      </div>
      <div class="hud-card hud-mutes-card" data-role="hud-mutes-card">
        <div class="hud-title" style="margin-bottom:6px;font-size:11px;color:var(--accent)">TRACK MUTES (CLICK TO TOGGLE)</div>
        <div class="mute-leds" data-role="mute-leds"></div>
      </div>
    `;

    this.projectTitleEl = this.root.querySelector('[data-role="project-title"]')!;
    this.liveDotEl = this.root.querySelector('[data-role="live-dot"]')!;
    this.songRowEl = this.root.querySelector('[data-role="song-row"]')!;
    this.patternEl = this.root.querySelector('[data-role="pattern"]')!;
    this.stepEl = this.root.querySelector('[data-role="step"]')!;
    this.bpmEl = this.root.querySelector('[data-role="bpm"]')!;
    this.timeEl = this.root.querySelector('[data-role="time"]')!;
    this.nextLabelEl = this.root.querySelector('[data-role="next-label"]')!;
    this.nextFillEl = this.root.querySelector('[data-role="hud-next-fill"]')!;
    this.progressFillEl = this.root.querySelector('[data-role="hud-progress-fill"]')!;
    this.muteLedsEl = this.root.querySelector('[data-role="mute-leds"]')!;
  }

  public setTimeline(timeline: CompiledTimeline | null): void {
    this.projectName = timeline?.projectName ?? 'NO PROJECT LOADED';
    this.songRows = timeline?.songRows ?? [];
    this.projectTitleEl.textContent = this.projectName;
    this.muteLedsEl.innerHTML = '';
    this.muteButtons = [];

    if (!timeline) return;

    for (const trk of timeline.tracks) {
      if (!trk.hasEvents && timeline.activeTrackIndices.length < timeline.tracks.length) {
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mute-btn';
      btn.textContent = trk.name.slice(0, 7);
      btn.style.borderColor = TRACK_HEX_PALETTE[trk.index % TRACK_HEX_PALETTE.length]!;
      btn.addEventListener('click', () => this.onToggleMute(trk.index));
      btn.dataset.trackIndex = String(trk.index);
      this.muteLedsEl.appendChild(btn);
      this.muteButtons.push(btn);
    }
  }

  private getPatternNextInfo(frame: FrameState): { nextText: string; rowPct: number } {
    const currRow = this.songRows[frame.songRow];
    const nextRow = this.songRows[frame.songRow + 1];
    const nextText = nextRow
      ? `NEXT → ${String(nextRow.songRow + 1).padStart(2, '0')} · ${nextRow.patternName.slice(0, 14)}`
      : 'FINAL SECTION';

    if (!currRow || currRow.stepCount <= 0) {
      return { nextText, rowPct: 0 };
    }
    const rowPct = Math.max(
      0,
      Math.min(1, (frame.gridStepFloat - currRow.startStepFloat) / currRow.stepCount)
    );
    return { nextText, rowPct };
  }

  public update(frame: FrameState, totalDurationSec: number): void {
    const totalRows = Math.max(1, this.songRows.length);
    this.liveDotEl.classList.toggle('playing', frame.isPlaying);
    this.songRowEl.textContent = `${String(frame.songRow + 1).padStart(2, '0')}/${String(totalRows).padStart(2, '0')}`;
    this.patternEl.textContent = frame.patternName.slice(0, 14);
    this.stepEl.textContent = String(frame.stepIndex).padStart(3, '0');
    this.bpmEl.textContent = String(Math.round(frame.bpm));

    const cur = this.formatTime(frame.timeSec);
    const tot = this.formatTime(totalDurationSec);
    this.timeEl.textContent = `${cur} / ${tot}`;

    const { nextText, rowPct } = this.getPatternNextInfo(frame);
    this.nextLabelEl.textContent = nextText;
    this.nextFillEl.style.width = `${(rowPct * 100).toFixed(2)}%`;

    const pct = totalDurationSec > 0 ? Math.min(100, (frame.timeSec / totalDurationSec) * 100) : 0;
    this.progressFillEl.style.width = `${pct.toFixed(2)}%`;

    for (const btn of this.muteButtons) {
      const idx = Number(btn.dataset.trackIndex);
      const isMuted = frame.activeMutes[idx] ?? false;
      btn.classList.toggle('muted', isMuted);
    }
  }

  /**
   * Draws the top-left Track Display directly onto a 2D export compositor canvas
   * so exported MP4/WebM renders match the clean-view preview.
   */
  public drawToExportCanvas(
    ctx: CanvasRenderingContext2D,
    frame: FrameState,
    totalDurationSec: number
  ): void {
    const x = 18;
    const y = 16;
    const w = 440;
    const h = 108;
    const r = 10;
    const totalRows = Math.max(1, this.songRows.length);

    ctx.save();

    // Rounded dark card background
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = 'rgba(8, 11, 20, 0.88)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.stroke();

    // Top cyan->violet->magenta accent bar
    ctx.save();
    ctx.clip();
    const topGrad = ctx.createLinearGradient(x, y, x + w, y);
    topGrad.addColorStop(0, '#00f0ff');
    topGrad.addColorStop(0.5, '#a855f7');
    topGrad.addColorStop(1, '#ff2e93');
    ctx.fillStyle = topGrad;
    ctx.fillRect(x, y, w, 2.5);
    ctx.restore();

    // Live indicator square + Project Title
    ctx.fillStyle = frame.isPlaying ? '#00f0ff' : '#475569';
    ctx.fillRect(x + 14, y + 15, 7, 7);

    ctx.font = '700 13px "JetBrains Mono", "SF Mono", ui-monospace, monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(this.projectName.toUpperCase().slice(0, 28), x + 28, y + 23);

    // Telemetry stats
    const cols = [
      { label: 'ROW', val: `${String(frame.songRow + 1).padStart(2, '0')}/${String(totalRows).padStart(2, '0')}`, accent: true, dx: 14 },
      { label: 'PATTERN', val: frame.patternName.slice(0, 12), accent: false, dx: 84 },
      { label: 'STEP', val: String(frame.stepIndex).padStart(3, '0'), accent: false, dx: 204 },
      { label: 'BPM', val: String(Math.round(frame.bpm)), accent: false, dx: 256 },
      { label: 'TIME', val: `${this.formatTime(frame.timeSec)} / ${this.formatTime(totalDurationSec)}`, accent: false, dx: 304 },
    ];

    for (const c of cols) {
      ctx.font = '600 9px ui-monospace, monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(c.label, x + c.dx, y + 43);
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.fillStyle = c.accent ? '#00f0ff' : '#f8fafc';
      ctx.fillText(c.val, x + c.dx, y + 60);
    }

    // NEXT pattern + countdown bar
    const { nextText, rowPct } = this.getPatternNextInfo(frame);
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(nextText, x + 14, y + 81);

    const nextBarX = x + 190;
    const nextBarY = y + 75;
    const nextBarW = w - 204;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.fillRect(nextBarX, nextBarY, nextBarW, 4);
    const nextGrad = ctx.createLinearGradient(nextBarX, nextBarY, nextBarX + nextBarW, nextBarY);
    nextGrad.addColorStop(0, '#00f0ff');
    nextGrad.addColorStop(1, '#ff2e93');
    ctx.fillStyle = nextGrad;
    ctx.fillRect(nextBarX, nextBarY, nextBarW * rowPct, 4);

    // Bottom overall song progress bar
    const barX = x + 14;
    const barY = y + 93;
    const barW = w - 28;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.fillRect(barX, barY, barW, 3);
    const pct = totalDurationSec > 0 ? Math.min(1, frame.timeSec / totalDurationSec) : 0;
    const progGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
    progGrad.addColorStop(0, '#00f0ff');
    progGrad.addColorStop(0.5, '#a855f7');
    progGrad.addColorStop(1, '#ff2e93');
    ctx.fillStyle = progGrad;
    ctx.fillRect(barX, barY, barW * pct, 3);

    ctx.restore();
  }

  private formatTime(sec: number): string {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
  }
}
