/// <reference lib="webworker" />
// Runs all-MiniLM-L6-v2 off the main thread. Every file it needs (model,
// tokenizer, onnxruntime WASM) is served by this site; remote models are off.
import { MAX_TOKENS, meanPoolNormalize } from '../lib/embed-math';
import { BROWSER_DTYPE, MODEL_ID, ORT_WASM } from '../lib/embed-config';

export type EmbedRequest = { id: number; type: 'load' } | { id: number; type: 'embed'; texts: string[] };
export type EmbedResponse =
  | { id: number; ok: true; vectors?: Float32Array[] }
  | { id: number; ok: false; error: string };

type Loaded = {
  tokenizer: (texts: string[], opts: object) => { attention_mask: { data: ArrayLike<number | bigint> } };
  model: (inputs: object) => Promise<{ last_hidden_state: { data: Float32Array; dims: number[] } }>;
};

let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    // Dynamic import: the ~1 MB library is fetched only when a model is needed.
    const { AutoModel, AutoTokenizer, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = '/models/';
    const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown; numThreads?: number };
    wasm.wasmPaths = { ...ORT_WASM };
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: BROWSER_DTYPE, device: 'wasm' });
    return { tokenizer, model } as unknown as Loaded;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const { tokenizer, model } = await load();
  const out: Float32Array[] = [];
  // One text per run, like the build script, so no padding is ever involved.
  for (const text of texts) {
    const inputs = tokenizer([text], { padding: true, truncation: true, max_length: MAX_TOKENS });
    const { last_hidden_state: h } = await model(inputs);
    const [b, s, d] = h.dims;
    out.push(...meanPoolNormalize(h.data, inputs.attention_mask.data, b, s, d));
  }
  return out;
}

self.onmessage = async (e: MessageEvent<EmbedRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load();
      self.postMessage({ id: msg.id, ok: true } satisfies EmbedResponse);
    } else {
      const vectors = await embed(msg.texts);
      self.postMessage({ id: msg.id, ok: true, vectors } satisfies EmbedResponse, vectors.map((v) => v.buffer as ArrayBuffer));
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies EmbedResponse);
  }
};
