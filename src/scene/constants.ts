import * as THREE from 'three';

export const STEP_Z_SPACING = 1.65;
export const HIGHWAY_TOTAL_WIDTH = 14.4;
export const LOOKAHEAD_STEPS = 44;
export const PAST_STEPS = 4;

export const TRACK_HEX_PALETTE = [
  '#00f0ff', // 0: Cyan
  '#ff2e93', // 1: Magenta
  '#ffe600', // 2: Acid Yellow
  '#39ff14', // 3: Neon Green
  '#ff6b00', // 4: Amber Orange
  '#a855f7', // 5: Electric Violet
  '#38bdf8', // 6: Sky Blue
  '#fb7185', // 7: Coral Rose
  '#2dd4bf', // 8: Teal
  '#facc15', // 9: Gold
  '#c084fc', // 10: Lavender
  '#4ade80', // 11: Mint
  '#f43f5e', // 12: Crimson
  '#60a5fa', // 13: Cobalt
  '#e879f9', // 14: Orchid
  '#fb923c', // 15: Tangerine
];

export const TRACK_THREE_COLORS = TRACK_HEX_PALETTE.map((hex) => new THREE.Color(hex));

export interface LaneLayout {
  visibleTrackIndices: number[];
  laneCount: number;
  laneWidth: number;
  trackToLaneIndex: Map<number, number>;
  getLaneX: (laneIdx: number) => number;
}

export function computeLaneLayout(visibleTrackIndices: number[]): LaneLayout {
  const laneCount = Math.max(1, visibleTrackIndices.length);
  const laneWidth = HIGHWAY_TOTAL_WIDTH / laneCount;
  const trackToLaneIndex = new Map<number, number>();
  visibleTrackIndices.forEach((trkIdx, laneIdx) => {
    trackToLaneIndex.set(trkIdx, laneIdx);
  });

  const startX = -HIGHWAY_TOTAL_WIDTH / 2 + laneWidth / 2;
  return {
    visibleTrackIndices,
    laneCount,
    laneWidth,
    trackToLaneIndex,
    getLaneX: (laneIdx: number) => startX + laneIdx * laneWidth,
  };
}
