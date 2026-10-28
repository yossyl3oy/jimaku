import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatGPTStream, MODEL, requireOK, responseDeltas, visibleModels } from '../src/core/chatgpt-responses.ts';
import { ProviderError } from '../src/core/errors.ts';

// A response body that arrives in the given pieces
const bodyOf = (...pieces: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
      controller.close();
    },
  });

const event = (data: object) => `event: x\ndata: ${JSON.stringify(data)}\n\n`;

const collect = async (stream: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const delta of stream) out.push(delta);
  return out;
};

test('responseDeltas: yields the text deltas even when events are split across chunks and use CRLF', async () => {
  const text = [
    event({ type: 'response.created' }),
    event({ type: 'response.output_text.delta', delta: '1\tこんにちは\n' }),
    event({ type: 'response.output_text.delta', delta: '2\tさようなら' }),
    event({ type: 'response.completed', response: {} }),
  ]
    .join('')
    .replace(/\n/g, '\r\n');
  // Cut between the CR and the LF, and in the middle of a multibyte character
  const bytes = new TextEncoder().encode(text);
  const cuts = [text.indexOf('\r') + 1, new TextEncoder().encode(text.slice(0, text.indexOf('こ'))).length + 1];
  const pieces = new ReadableStream<Uint8Array>({
    start(controller) {
      let from = 0;
      for (const cut of [...cuts, bytes.length]) {
        controller.enqueue(bytes.slice(from, cut));
        from = cut;
      }
      controller.close();
    },
  });
  assert.deepEqual(await collect(responseDeltas(pieces)), ['1\tこんにちは\n', '2\tさようなら']);
});

test('responseDeltas: a failed response throws its error code', async () => {
  const body = bodyOf(
    event({ type: 'response.output_text.delta', delta: 'a' }),
    event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } })
  );
  await assert.rejects(collect(responseDeltas(body)), (error: ProviderError) => {
    assert.equal(error.code, 'subscription_sharing_usage_limit_exceeded');
    return true;
  });
});

test('responseDeltas: a stream that ends before response.completed is an error', async () => {
  const body = bodyOf(event({ type: 'response.output_text.delta', delta: 'a' }));
  await assert.rejects(collect(responseDeltas(body)), (error: ProviderError) => error.code === 'stream_interrupted');
});

test('requireOK: the error code comes from the body, without the body in the message', async () => {
  const response = new Response(JSON.stringify({ error: { code: 'invalid_grant', message: 'secret-ish detail' } }), { status: 400 });
  await assert.rejects(requireOK(response), (error: ProviderError) => {
    assert.equal(error.code, 'invalid_grant');
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
  await assert.rejects(requireOK(new Response('nope', { status: 401 })), (error: ProviderError) => error.code === 'http_401');
});

test('visibleModels: only listed models', () => {
  const body = { models: [{ slug: MODEL, visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }, { visibility: 'list' }] };
  assert.deepEqual(visibleModels(body), [MODEL]);
  assert.throws(() => visibleModels({}), ProviderError);
});

test('chatGPTStream: posts the prompt with the fixed model, reasoning off and nothing else', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(bodyOf(event({ type: 'response.output_text.delta', delta: 'ok' }), event({ type: 'response.completed' })));
  }) as unknown as typeof fetch;
  const stream = chatGPTStream(async () => 'access-1', fakeFetch);
  assert.deepEqual(await collect(stream('PROMPT')), ['ok']);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer access-1');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    model: MODEL,
    input: [{ role: 'user', content: 'PROMPT' }],
    reasoning: { effort: 'none' },
    store: false,
    stream: true,
  });
});
