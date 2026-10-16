// Shared types for the adaptive brain. Pure data: no DOM, no timers.

export const AXES = ['ml', 'dl', 'software', 'data', 'research'] as const;
export type Axis = (typeof AXES)[number];
export type Vec = number[];

/** Plain-English names used in explanations. */
export const AXIS_LABEL: Record<Axis, string> = {
  ml: 'machine learning',
  dl: 'deep learning',
  software: 'systems',
  data: 'data',
  research: 'research',
};

/** Short names for the radar chart. */
export const AXIS_SHORT: Record<Axis, string> = {
  ml: 'ML',
  dl: 'DL',
  software: 'Software',
  data: 'Data',
  research: 'Research',
};

/** One recommendable thing on the page (the research card or a project card). */
export interface BrainItem {
  id: string;
  type: string;
  title: string;
  /** 5-d interest weights in AXES order, each 0..1. */
  axes: Vec;
  /** The vector ranking happens in: a 384-d text embedding, or the axes as a fallback. */
  vector: Vec;
  /** Dominant axis, used for topic penalties and explanations. */
  topic: Axis;
}

/** Raw item as it comes from content, before vectors are attached. */
export interface ItemInput {
  id: string;
  type: string;
  title: string;
  axes: Record<Axis, number>;
}

export type SignalKind =
  | 'demo' // demo used: strongest
  | 'expand' // card opened: strong
  | 'ask' // "Ask about me" query: strong; the query vector is the signal
  | 'dwell' // reading time: medium, log-scaled, capped at 60 s per item
  | 'signboard' // first signboard tapped: medium
  | 'opener' // opener chip picked
  | 'fast-scroll' // scrolled past quickly: weak negative
  | 'dismiss'; // suggestion dismissed: negative

export interface Signal {
  kind: SignalKind;
  itemId?: string;
  /** For 'ask': the query embedding. */
  vector?: Vec;
  /**
   * For 'ask': ids of the result items (used for the axis profile, and as the
   * vector when the query vector is missing or in another space).
   * For 'signboard': the items in the tapped section.
   */
  itemIds?: string[];
  /** For 'dwell': seconds of qualifying reading in this segment. */
  seconds?: number;
  /** For 'signboard': the section id. For 'opener': the chip label. */
  label?: string;
  /** For 'opener' and 'signboard': an axis direction. */
  axesBoost?: Partial<Record<Axis, number>>;
}

/** Strength of each signal (negative pushes the profile away). */
export const STRENGTH: Record<SignalKind, number> = {
  demo: 1,
  expand: 0.7,
  ask: 0.7,
  dwell: 0.5, // multiplied by the log-scaled dwell gain (0..1)
  signboard: 0.4,
  opener: 0.8,
  'fast-scroll': -0.1,
  dismiss: -0.4,
};

export type Clock = () => number;
export type Rng = () => number;

/** Key-value storage with the localStorage shape; any call may throw. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
