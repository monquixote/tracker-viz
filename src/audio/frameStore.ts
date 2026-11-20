import type {
  CompiledStep,
  CompiledTimeline,
  FXBadge,
  FrameState,
  NoteEvent,
} from '../types/timeline.ts';

export class FrameStateStore {
  private timeline: CompiledTimeline | null = null;
  private prevTimeSec = -1;
  private prevGridStep = -1;

  public setTimeline(timeline: CompiledTimeline | null): void {
    this.timeline = timeline;
    this.prevTimeSec = -1;
    this.prevGridStep = -1;
  }

  public getTimeline(): CompiledTimeline | null {
    return this.timeline;
  }

  public resetPrevTime(timeSec = -1): void {
    this.prevTimeSec = timeSec;
    this.prevGridStep = -1;
  }

  private findStepIndexByGrid(steps: CompiledStep[], gridStepFloat: number): number {
    let lo = 0;
    let hi = steps.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const step = steps[mid]!;
      if (step.gridStepFloat <= gridStepFloat) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  private findStepIndex(steps: CompiledStep[], timeSec: number): number {
    let lo = 0;
    let hi = steps.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const step = steps[mid]!;
      if (step.timeSec <= timeSec) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  public evaluate(
    timeSec: number,
    isPlaying: boolean,
    lookaheadSteps = 44,
    pastSteps = 4
  ): FrameState {
    if (!this.timeline || this.timeline.steps.length === 0) {
      return {
        timeSec,
        isPlaying,
        songRow: 0,
        patternIndex: 0,
        patternName: 'NO PROJECT',
        stepIndex: 0,
        stepProgress: 0,
        gridStepFloat: 0,
        bpm: 120,
        visibleNotes: [],
        justTriggeredNotes: [],
        activeFxBadges: [],
      };
    }

    const { steps, allNotes } = this.timeline;
    const clampedTime = Math.max(0, Math.min(timeSec, this.timeline.totalDurationSec));
    const idx = this.findStepIndex(steps, clampedTime);
    const currentStep = steps[idx]!;

    const elapsedInStep = Math.max(0, clampedTime - currentStep.timeSec);
    const stepProgress =
      currentStep.durationSec > 0
        ? Math.min(1, elapsedInStep / currentStep.durationSec)
        : 0;
    const gridStepFloat = currentStep.gridStepFloat + stepProgress;

    const minGrid = gridStepFloat - pastSteps;
    const maxGrid = gridStepFloat + lookaheadSteps;

    // Slice visible notes (including notes whose sustain tail overlaps the window)
    const visibleNotes: NoteEvent[] = [];
    for (let i = 0; i < allNotes.length; i++) {
      const n = allNotes[i]!;
      if (n.gridStepFloat > maxGrid + 2) break;
      if (n.gridStepFloat <= maxGrid && n.endStepFloat >= minGrid) {
        visibleNotes.push(n);
      }
    }

    // Detect notes crossed since previous frame
    const justTriggeredNotes: NoteEvent[] = [];
    if (isPlaying && clampedTime >= this.prevTimeSec) {
      const prev = this.prevTimeSec < 0 ? -0.0001 : this.prevTimeSec;
      const dt = clampedTime - prev;
      // Avoid burst-triggering on large seeks
      if (dt > 0 && dt < 0.25) {
        for (let i = 0; i < allNotes.length; i++) {
          const n = allNotes[i]!;
          if (n.triggerTimeSec > clampedTime) break;
          if (
            n.triggerTimeSec > prev &&
            n.triggerTimeSec <= clampedTime &&
            n.kind === 'note'
          ) {
            justTriggeredNotes.push(n);
          }
        }
      }
    }

    this.prevTimeSec = clampedTime;

    const activeFxBadges: Array<{ trackIndex: number; badge: FXBadge }> = [];
    for (const n of currentStep.notes) {
      if (n.fx1) activeFxBadges.push({ trackIndex: n.trackIndex, badge: n.fx1 });
      if (n.fx2) activeFxBadges.push({ trackIndex: n.trackIndex, badge: n.fx2 });
    }

    return {
      timeSec: clampedTime,
      isPlaying,
      songRow: currentStep.songRow,
      patternIndex: currentStep.patternIndex,
      patternName: currentStep.patternName,
      stepIndex: currentStep.stepIndex,
      stepProgress,
      gridStepFloat,
      bpm: currentStep.bpm,
      visibleNotes,
      justTriggeredNotes,
      activeFxBadges,
    };
  }

  /**
   * Evaluates FrameState directly from a continuous Tracker step coordinate
   * (used by Phase 2 Live Web MIDI 24-PPQN Clock sync, 6 ticks = 1 step).
   */
  public evaluateAtGridStep(
    rawGridStepFloat: number,
    isPlaying: boolean,
    measuredBpm?: number,
    lookaheadSteps = 44,
    pastSteps = 4
  ): FrameState {
    if (!this.timeline || this.timeline.steps.length === 0) {
      return this.evaluate(0, isPlaying, lookaheadSteps, pastSteps);
    }

    const { steps, allNotes, totalSteps } = this.timeline;
    const gridStepFloat = Math.max(0, Math.min(rawGridStepFloat, Math.max(0, totalSteps - 0.001)));
    const idx = this.findStepIndexByGrid(steps, gridStepFloat);
    const currentStep = steps[idx]!;
    const stepProgress = Math.max(0, Math.min(1, gridStepFloat - currentStep.gridStepFloat));
    const timeSec = currentStep.timeSec + stepProgress * currentStep.durationSec;

    const minGrid = gridStepFloat - pastSteps;
    const maxGrid = gridStepFloat + lookaheadSteps;

    const visibleNotes: NoteEvent[] = [];
    for (let i = 0; i < allNotes.length; i++) {
      const n = allNotes[i]!;
      if (n.gridStepFloat > maxGrid + 2) break;
      if (n.gridStepFloat <= maxGrid && n.endStepFloat >= minGrid) visibleNotes.push(n);
    }

    const justTriggeredNotes: NoteEvent[] = [];
    if (isPlaying && gridStepFloat >= this.prevGridStep) {
      const prev = this.prevGridStep < 0 ? -0.001 : this.prevGridStep;
      if (gridStepFloat - prev < 3) {
        for (let i = 0; i < allNotes.length; i++) {
          const n = allNotes[i]!;
          if (n.gridStepFloat > gridStepFloat + 2) break;
          if (
            n.gridStepFloat > prev &&
            n.gridStepFloat <= gridStepFloat &&
            n.kind === 'note'
          ) {
            justTriggeredNotes.push(n);
          }
        }
      }
    }
    this.prevGridStep = gridStepFloat;

    const activeFxBadges: Array<{ trackIndex: number; badge: FXBadge }> = [];
    for (const n of currentStep.notes) {
      if (n.fx1) activeFxBadges.push({ trackIndex: n.trackIndex, badge: n.fx1 });
      if (n.fx2) activeFxBadges.push({ trackIndex: n.trackIndex, badge: n.fx2 });
    }

    return {
      timeSec,
      isPlaying,
      songRow: currentStep.songRow,
      patternIndex: currentStep.patternIndex,
      patternName: currentStep.patternName,
      stepIndex: currentStep.stepIndex,
      stepProgress,
      gridStepFloat,
      bpm: measuredBpm && measuredBpm > 20 ? measuredBpm : currentStep.bpm,
      visibleNotes,
      justTriggeredNotes,
      activeFxBadges,
    };
  }
}
