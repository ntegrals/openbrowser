export interface DomNode {
  tag: string;
  attributes: Record<string, string>;
  text?: string;
  children: DomNode[];
  rect?: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  tree: string;
  interactiveCount: number;
  timestamp: number;
}

export interface ScrollPosition {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
}
