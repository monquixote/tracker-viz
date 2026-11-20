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

  private projectName = 'TRACKER-VIZ';
  private songRows: SongRowInfo[] = [];

  constructor() {
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
  }

  public setTimeline(timeline: CompiledTimeline | null): void {
    this.projectName = timeline?.projectName ?? 'NO PROJECT LOADED';
    this.songRows = timeline?.songRows ?? [];
    this.projectTitleEl.textContent = this.projectName;
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
  }

  /**
   * Draws the top-left Track Display directly onto a 2D export compositor canvas
   * within video safe margins so exported MP4/WebM renders match the clean-view preview.
   */
  public drawToExportCanvas(
    ctx: CanvasRenderingContext2D,
    frame: FrameState,
    totalDurationSec: number
  ): void {
    const scale = ctx.canvas.width / 1920;
    const x = 72;
    const y = 52;
    const w = 556;
    const h = 138;
    const r = 12;
    const totalRows = Math.max(1, this.songRows.length);

    ctx.save();
    ctx.scale(scale, scale);

    // Rounded dark card background
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = 'rgba(8, 11, 20, 0.88)';
    ctx.fill();
    ctx.lineWidth = 1.25;
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
    ctx.fillRect(x, y, w, 3);
    ctx.restore();

    // Live indicator square + Project Title
    ctx.fillStyle = frame.isPlaying ? '#00f0ff' : '#475569';
    ctx.fillRect(x + 18, y + 19, 9, 9);

    ctx.font = '700 17px "JetBrains Mono", "SF Mono", ui-monospace, monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(this.projectName.toUpperCase().slice(0, 28), x + 36, y + 29);

    // Telemetry stats
    const cols = [
      { label: 'ROW', val: `${String(frame.songRow + 1).padStart(2, '0')}/${String(totalRows).padStart(2, '0')}`, accent: true, dx: 18 },
      { label: 'PATTERN', val: frame.patternName.slice(0, 12), accent: false, dx: 98 },
      { label: 'STEP', val: String(frame.stepIndex).padStart(3, '0'), accent: false, dx: 236 },
      { label: 'BPM', val: String(Math.round(frame.bpm)), accent: false, dx: 300 },
      { label: 'TIME', val: `${this.formatTime(frame.timeSec)} / ${this.formatTime(totalDurationSec)}`, accent: false, dx: 364 },
    ];

    for (const c of cols) {
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(c.label, x + c.dx, y + 54);
      ctx.font = '700 16px ui-monospace, monospace';
      ctx.fillStyle = c.accent ? '#00f0ff' : '#f8fafc';
      ctx.fillText(c.val, x + c.dx, y + 75);
    }

    // NEXT pattern + countdown bar
    const { nextText, rowPct } = this.getPatternNextInfo(frame);
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(nextText, x + 18, y + 102);

    const nextBarX = x + 236;
    const nextBarY = y + 95;
    const nextBarW = w - 254;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.fillRect(nextBarX, nextBarY, nextBarW, 5);
    const nextGrad = ctx.createLinearGradient(nextBarX, nextBarY, nextBarX + nextBarW, nextBarY);
    nextGrad.addColorStop(0, '#00f0ff');
    nextGrad.addColorStop(1, '#ff2e93');
    ctx.fillStyle = nextGrad;
    ctx.fillRect(nextBarX, nextBarY, nextBarW * rowPct, 5);

    // Bottom overall song progress bar
    const barX = x + 18;
    const barY = y + 118;
    const barW = w - 36;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.fillRect(barX, barY, barW, 4);
    const pct = totalDurationSec > 0 ? Math.min(1, frame.timeSec / totalDurationSec) : 0;
    const progGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
    progGrad.addColorStop(0, '#00f0ff');
    progGrad.addColorStop(0.5, '#a855f7');
    progGrad.addColorStop(1, '#ff2e93');
    ctx.fillStyle = progGrad;
    ctx.fillRect(barX, barY, barW * pct, 4);

    ctx.restore();
  }

  private formatTime(sec: number): string {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
  }
}
