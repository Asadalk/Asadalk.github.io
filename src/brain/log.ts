// Decision log: every decision the brain makes, with a plain-English reason.
// The panel shows the last three that changed something the visitor can see.
import { AXES, AXIS_LABEL, type Axis, type BrainItem } from './types';
import type { VisitorModel } from './model';

export type DecisionKind =
  | 'reorder'
  | 'headline'
  | 'suggest'
  | 'outcome'
  | 'hold'
  | 'quiet'
  | 'depth'
  | 'skimmer'
  | 'opener'
  | 'reset';

export interface Decision {
  at: number;
  kind: DecisionKind;
  text: string;
  /** Shown in the panel's "recent decisions" (holds are logged but not shown). */
  visible: boolean;
}

export class DecisionLog {
  constructor(
    public entries: Decision[] = [],
    readonly max = 60,
  ) {}

  add(at: number, kind: DecisionKind, text: string, visible = kind !== 'hold'): Decision {
    const d = { at, kind, text, visible };
    this.entries.push(d);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    return d;
  }

  recent(n = 3): Decision[] {
    return this.entries.filter((e) => e.visible).slice(-n).reverse();
  }
}

/** The axis that most explains why this item suits the profile. */
export function driverAxis(item: BrainItem, profileAxes: number[] | null): Axis {
  if (!profileAxes) return item.topic;
  let best = 0;
  for (let i = 1; i < AXES.length; i++)
    if (item.axes[i] * profileAxes[i] > item.axes[best] * profileAxes[best]) best = i;
  return AXES[best];
}

/** "because you spent 40 s on systems content" and similar. */
export function because(item: BrainItem, model: VisitorModel): string {
  const axis = driverAxis(item, model.state.axes);
  const k = AXES.indexOf(axis);
  let seconds = 0;
  for (const other of model.items) {
    if (other.axes[k] >= 0.6) seconds += model.state.items[other.id]?.dwell ?? 0;
  }
  if (seconds >= 5) return `because you spent ${Math.round(seconds)} s on ${AXIS_LABEL[axis]} content`;
  const last = model.state.lastEngaged ? model.byId.get(model.state.lastEngaged) : undefined;
  if (last && last.id !== item.id) return `because you opened ${last.title}`;
  if (model.state.opener) return `because you picked "${model.state.opener}"`;
  return `because of what you have read so far`;
}
