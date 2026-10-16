// Node-side embedder: the same self-hosted model files and the same pooling
// code (src/lib/embed-math.ts) the browser worker uses. Build scripts and the
// parity test share it. Never downloads anything.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { MAX_TOKENS, meanPoolNormalize } from '../../src/lib/embed-math.ts';

export const MODEL_ID = 'all-MiniLM-L6-v2';
/** Which ONNX weights the site ships (see docs/decisions.md, Phase 4). */
export const MODEL_DTYPE = 'fp32';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
env.allowRemoteModels = false;
env.localModelPath = join(root, 'public/models') + '/';

export async function loadEmbedder(dtype = MODEL_DTYPE) {
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const model = await AutoModel.from_pretrained(MODEL_ID, { dtype, device: 'cpu' });
  /** @param {string[]} texts @returns {Promise<Float32Array[]>} */
  async function embed(texts) {
    const out = [];
    for (const text of texts) {
      const inputs = tokenizer([text], { padding: true, truncation: true, max_length: MAX_TOKENS });
      const { last_hidden_state: h } = await model(inputs);
      const [b, s, d] = h.dims;
      out.push(...meanPoolNormalize(h.data, inputs.attention_mask.data, b, s, d));
    }
    return out;
  }
  return { embed, dtype };
}
