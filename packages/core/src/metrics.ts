export function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) table[row][0] = row;
  for (let column = 0; column < columns; column += 1) table[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      table[row][column] = Math.min(
        table[row - 1][column] + 1,
        table[row][column - 1] + 1,
        table[row - 1][column - 1] + cost,
      );
    }
  }
  return table[left.length][right.length];
}

export function cer(hypothesis: string, reference: string): number {
  if (!reference) return hypothesis ? 1 : 0;
  return levenshtein(hypothesis, reference) / [...reference].length;
}

export function wer(hypothesis: string, reference: string): number {
  const left = hypothesis.trim().split(/\s+/).filter(Boolean);
  const right = reference.trim().split(/\s+/).filter(Boolean);
  if (right.length === 0) return left.length === 0 ? 0 : 1;
  return tokenWer(left, right);
}

function tokenWer(left: string[], right: string[]): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) table[row][0] = row;
  for (let column = 0; column < columns; column += 1) table[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      table[row][column] = Math.min(
        table[row - 1][column] + 1,
        table[row][column - 1] + 1,
        table[row - 1][column - 1] + cost,
      );
    }
  }
  return table[left.length][right.length] / right.length;
}

export function precisionRecallF1(predicted: string[][], expected: string[][]): { precision: number; recall: number; f1: number } {
  let truePositive = 0;
  let predictedCount = 0;
  let expectedCount = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const guess = new Set(predicted[index] ?? []);
    const truth = new Set(expected[index] ?? []);
    predictedCount += guess.size;
    expectedCount += truth.size;
    for (const label of guess) if (truth.has(label)) truePositive += 1;
  }
  const precision = predictedCount === 0 ? 0 : truePositive / predictedCount;
  const recall = expectedCount === 0 ? 0 : truePositive / expectedCount;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export function retrievalMetrics(rankings: { relevant: Set<string>; ranked: string[] }[], k: number): { recallAtK: number; precisionAtK: number; mrr: number } {
  let recall = 0;
  let precision = 0;
  let reciprocal = 0;
  for (const item of rankings) {
    const top = item.ranked.slice(0, k);
    const hits = top.filter((id) => item.relevant.has(id)).length;
    recall += item.relevant.size === 0 ? 0 : hits / item.relevant.size;
    precision += top.length === 0 ? 0 : hits / top.length;
    const first = item.ranked.findIndex((id) => item.relevant.has(id));
    reciprocal += first >= 0 ? 1 / (first + 1) : 0;
  }
  const count = rankings.length || 1;
  return { recallAtK: recall / count, precisionAtK: precision / count, mrr: reciprocal / count };
}

export function tokenF1(hypothesis: string, reference: string): number {
  const left = hypothesis.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const right = reference.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (left.length === 0 && right.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const token of right) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of left) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(token, remaining - 1);
    }
  }
  const precision = left.length === 0 ? 0 : overlap / left.length;
  const recall = right.length === 0 ? 0 : overlap / right.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}
