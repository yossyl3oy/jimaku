// Calls to the Responses API with a ChatGPT plan token (Sign in with ChatGPT), and reading its event stream.
// https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
// (Rewritten from rokrokss/shizue@c2ebc51 src/lib/chatgptResponses.ts.)

import { ProviderError } from './errors.ts';
import type { StreamFn } from './prompt.ts';

export const API = 'https://api.openai.com/v1';

// The model is fixed so that no catalog request is needed per translation. It is checked against the catalog once at sign-in.
// It supports reasoning effort "none", which keeps TTFT short. Chosen with the model benchmark (src/bench/, 2026-10-31):
// it had the fewest output tokens and the most faithful translations (consistent speaker names, puns translated by
// meaning, lines kept in place). Its first line comes about 0.3s after gpt-6-luna's, which moved lines out of place,
// within the 2-3s the server takes to start answering.
export const MODEL = 'gpt-6-sol';

export const requireOK = async (response: Response): Promise<Response> => {
  if (response.ok) return response;
  const body = await response.json().catch(() => ({}));
  const code = body?.error?.code ?? body?.error ?? `http_${response.status}`;
  // The body is not passed on: OAuth errors can echo credentials
  throw new ProviderError(typeof code === 'string' ? code : `http_${response.status}`, `ChatGPT request failed (${response.status})`);
};

export const readJSON = async (response: Response): Promise<any> => {
  try {
    return await response.json();
  } catch {
    throw new ProviderError('invalid_provider_response', 'ChatGPT returned an unreadable response');
  }
};

// The models the account can use (GET /v1/models returns { models: [{ slug, visibility, ... }] })
export const visibleModels = (body: unknown): string[] => {
  const models = (body as { models?: unknown })?.models;
  if (!Array.isArray(models)) throw new ProviderError('invalid_provider_response', 'ChatGPT returned an invalid model catalog');
  return models.filter((model) => model?.visibility === 'list' && typeof model.slug === 'string').map((model) => model.slug);
};

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
export type RequestOptions = { model?: string; effort?: ReasoningEffort };

// Only these fields are sent. SIWC rejects many Responses API options (temperature, max_output_tokens, ...).
// The model and effort can be changed for the model benchmark (src/bench/); translation uses the defaults.
export const responseRequestBody = (prompt: string, { model = MODEL, effort = 'none' }: RequestOptions = {}) => ({
  model,
  input: [{ role: 'user', content: prompt }],
  reasoning: { effort },
  store: false,
  stream: true,
});

// The token counts of a completed response (response.completed → response.usage)
export type Usage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
};

// Reads the server-sent events and yields the text deltas. Throws when the response fails or ends before completing.
// onUsage gets the token counts once the response completes.
export async function* responseDeltas(
  body: ReadableStream<Uint8Array> | null,
  onUsage?: (usage: Usage) => void
): AsyncGenerator<string> {
  if (!body) throw new ProviderError('invalid_provider_response', 'ChatGPT returned no response stream');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const parse = (block: string) => {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return null;
    try {
      return JSON.parse(data);
    } catch {
      throw new ProviderError('invalid_stream_event', 'ChatGPT returned an invalid stream event');
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // CRLF is normalized after decoding (a CR and its LF can arrive in different chunks)
      pending = (pending + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const event = parse(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
        if (!event) continue;
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') yield event.delta;
        if (event.type === 'response.failed' || event.type === 'error') {
          throw new ProviderError(
            event.response?.error?.code ?? event.code ?? 'response_failed',
            'ChatGPT could not complete this response'
          );
        }
        if (event.type === 'response.incomplete') throw new ProviderError('response_incomplete', 'ChatGPT returned an incomplete response');
        if (event.type === 'response.completed') return onUsage?.(event.response?.usage ?? {});
      }
      if (pending.length > 1024 * 1024) throw new ProviderError('invalid_stream_event', 'ChatGPT stream event is too large');
      if (done) break;
    }
    // A last event without the trailing blank line
    const last = parse(pending);
    if (last?.type === 'response.completed') return onUsage?.(last.response?.usage ?? {});
    throw new ProviderError('stream_interrupted', 'ChatGPT stream ended before completion');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// A StreamFn that translates with the ChatGPT plan. Runs in the background service worker (CORS blocks content scripts).
export const chatGPTStream =
  (accessToken: () => Promise<string>, fetchFn: typeof fetch = (input, init) => fetch(input, init)): StreamFn =>
  async function* (prompt, signal) {
    const token = await accessToken();
    signal?.throwIfAborted();
    // Chrome may stop the service worker when a fetch response takes more than 30 seconds to arrive, so give up first.
    // Once the stream flows, each piece sent over the port keeps the worker alive.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new ProviderError('timeout', 'ChatGPT did not answer in time')), 25_000);
    let response;
    try {
      response = await fetchFn(`${API}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(responseRequestBody(prompt)),
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    yield* responseDeltas((await requireOK(response)).body);
  };
