export const POSITION_STEP = 1024;

const MIN_GAP = 1e-6;

function sequence(count: number, at: (index: number) => number): number[] {
  return Array.from({ length: count }, (_, index) => at(index));
}

function strictlyIncreasing(values: number[], lower?: number, upper?: number): boolean {
  let previous = lower ?? -Infinity;
  for (const value of values) {
    if (!(value > previous)) return false;
    previous = value;
  }
  return upper === undefined || previous < upper;
}

export function positionsBetween(
  before: number | undefined,
  after: number | undefined,
  count: number,
): number[] | null {
  if (count <= 0) return [];

  let result: number[];
  if (before === undefined && after === undefined) {
    result = sequence(count, (i) => (i + 1) * POSITION_STEP);
  } else if (after === undefined) {
    result = sequence(count, (i) => (before as number) + (i + 1) * POSITION_STEP);
  } else if (before === undefined) {
    result = sequence(count, (i) => after - (count - i) * POSITION_STEP);
  } else {
    const gap = (after - before) / (count + 1);
    if (!(gap > MIN_GAP)) return null;
    result = sequence(count, (i) => before + gap * (i + 1));
  }

  return strictlyIncreasing(result, before, after) ? result : null;
}

export function evenPositions(count: number): number[] {
  return sequence(count, (i) => (i + 1) * POSITION_STEP);
}
