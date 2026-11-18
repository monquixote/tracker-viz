declare module 'troika-three-text' {
  import * as THREE from 'three';

  export class Text extends THREE.Mesh {
    text: string;
    font: string;
    fontSize: number;
    fontWeight: 'normal' | 'bold' | number;
    sdfGlyphSize: number;
    maxWidth: number;
    clipRect: [number, number, number, number] | null;
    fillOpacity: number;
    color: string | number | THREE.Color;
    anchorX: number | 'left' | 'center' | 'right';
    anchorY: number | 'top' | 'top-baseline' | 'middle' | 'bottom-baseline' | 'bottom';
    lineHeight: number | 'normal';
    letterSpacing: number;
    outlineWidth: number | string;
    outlineColor: string | number | THREE.Color;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
