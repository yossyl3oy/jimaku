import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../src/core/errors.ts';
import type { StreamFn } from '../src/core/prompt.ts';
import { portStream, servePort, type PortLike } from '../src/core/port-stream.ts';

// Two connected fake ports, delivering messages asynchronously like chrome.runtime ports
type FakePort = PortLike & {
  peer?: FakePort;
  alive: boolean;
  messageListeners: ((message: unknown) => void)[];
  disconnectListeners: (() => void)[];
};

const fakePort = (): FakePort => {
  const port: FakePort = {
    alive: true,
    messageListeners: [],
    disconnectListeners: [],
    postMessage(message) {
      if (!port.alive) throw new Error('disconnected');
      const copy = structuredClone(message);
      setImmediate(() => port.peer!.messageListeners.forEach((listener) => listener(copy)));
    },
    disconnect() {
      if (!port.alive) return;
      port.alive = port.peer!.alive = false;
      setImmediate(() => port.peer!.disconnectListeners.forEach((listener) => listener()));
    },
    onMessage: { addListener: (listener) => port.messageListeners.push(listener) },
    onDisconnect: { addListener: (listener) => port.disconnectListeners.push(listener) },
  };
  return port;
};

const portPair = () => {
  const client = fakePort();
  const server = fakePort();
  client.peer = server;
  server.peer = client;
  return { client, server };
};

const collect = async (stream: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const delta of stream) out.push(delta);
  return out;
};

const connectTo = (background: StreamFn) => () => {
  const { client, server } = portPair();
  servePort(server, background);
  return client;
};

test('portStream: the background stream arrives piece by piece', async () => {
  const background: StreamFn = async function* (prompt) {
    yield `${prompt}-1`;
    yield `${prompt}-2`;
  };
  assert.deepEqual(await collect(portStream(connectTo(background))('p')), ['p-1', 'p-2']);
});

test('portStream: an error in the background comes back with its code', async () => {
  const background: StreamFn = async function* () {
    yield 'a';
    throw new ProviderError('login_required', 'Not signed in');
  };
  await assert.rejects(collect(portStream(connectTo(background))('p')), (error: ProviderError) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, 'login_required');
    return true;
  });
});

test('portStream: aborting cancels the request in the background', async () => {
  let backgroundSignal: AbortSignal | undefined;
  const background: StreamFn = async function* (_prompt, signal) {
    backgroundSignal = signal;
    yield 'first';
    await new Promise((resolve) => signal?.addEventListener('abort', resolve));
  };
  const controller = new AbortController();
  const seen: string[] = [];
  await assert.rejects(async () => {
    for await (const delta of portStream(connectTo(background))('p', controller.signal)) {
      seen.push(delta);
      controller.abort(new Error('seek'));
    }
  }, /seek/);
  assert.deepEqual(seen, ['first']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backgroundSignal?.aborted, true);
});

test('portStream: a port that closes before finishing is an error', async () => {
  const connect = () => {
    const { client, server } = portPair();
    server.onMessage.addListener(() => server.disconnect());
    return client;
  };
  await assert.rejects(collect(portStream(connect)('p')), (error: ProviderError) => error.code === 'port_closed');
});

test('portStream: aborting after the extension was reloaded (disconnect throws, no disconnect event) still ends it', async () => {
  const { client } = portPair();
  client.disconnect = () => {
    throw new Error('Extension context invalidated.');
  };
  const controller = new AbortController();
  const next = portStream(() => client)('p', controller.signal)[Symbol.asyncIterator]().next();
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('stopped'));
  await assert.rejects(next, /stopped/);
});
