// Vector maths shared by the browser worker, the build-time embedding script
// and the tests. No imports, so plain Node can load this file too.

/** all-MiniLM-L6-v2 output size. */
export const DIM = 384;

/**
 * sentence-transformers truncates this model's input at 256 word pieces
 * (its `max_seq_length`). The tokenizer config says 512, so the browser must
 * be told explicitly or long resumes would be embedded differently.
 */
export const MAX_TOKENS = 256;

/**
 * Mean pooling + L2 normalisation, exactly what sentence-transformers does
 * for this model: average the token vectors that are real tokens (mask = 1),
 * then scale the average to length 1.
 *
 * `hidden` is the model's last hidden state flattened as [batch, seq, dim].
 */
export function meanPoolNormalize(
  hidden: ArrayLike<number>,
  mask: ArrayLike<number | bigint>,
  batch: number,
  seq: number,
  dim: number,
): Float32Array[] {
  const out: Float32Array[] = [];
  for (let b = 0; b < batch; b++) {
    const sum = new Float64Array(dim);
    let count = 0;
    for (let t = 0; t < seq; t++) {
      if (Number(mask[b * seq + t]) === 0) continue;
      count++;
      const base = (b * seq + t) * dim;
      for (let d = 0; d < dim; d++) sum[d] += hidden[base + d];
    }
    // sentence-transformers clamps the token count at 1e-9 to avoid 0/0.
    const n = Math.max(count, 1e-9);
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      sum[d] /= n;
      norm += sum[d] * sum[d];
    }
    // torch.nn.functional.normalize uses eps = 1e-12.
    norm = Math.max(Math.sqrt(norm), 1e-12);
    const v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) v[d] = sum[d] / norm;
    out.push(v);
  }
  return out;
}

/** Dot product. For unit-length vectors this *is* the cosine similarity. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Cosine similarity for vectors of any length. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na && nb ? dot(a, b) / (na * nb) : 0;
}

/** Round each component, for compact JSON. 5 decimals keeps cosines within ~1e-5. */
export function roundVector(v: ArrayLike<number>, decimals = 5): number[] {
  const f = 10 ** decimals;
  return Array.from(v, (x) => Math.round(x * f) / f);
}
