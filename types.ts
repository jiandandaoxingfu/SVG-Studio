export interface DOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformState {
  translate: { x: number; y: number };
  rotate: number; // degrees
  scale: { x: number; y: number };
}

export type InteractionMode = 'idle' | 'dragging' | 'rotating' | 'scaling-tl' | 'scaling-tr' | 'scaling-bl' | 'scaling-br';
