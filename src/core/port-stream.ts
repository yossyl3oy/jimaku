// Carries a StreamFn across a chrome.runtime port: the content script sends the prompt, the background service worker
// streams the text back. One request per port; disconnecting the port cancels the request.
// It only needs the shape of a port, so tests pass a pair of fake ports.

import { ProviderError } from './errors.ts';
import type { StreamFn } from './prompt.ts';

export const TRANSLATE_PORT = 'translate';

type Event<T extends unknown[]> = { addListener(listener: (...args: T) => void): void };

export type PortLike = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: Event<[unknown]>;
  onDisconnect: Event<[]>;
};

export type PortRequest = { prompt: string };
export type PortReply = { delta: string } | { done: true } | { error: { code: string; message: string } };

// Content script side
export const portStream =
  (connect: () => PortLike): StreamFn =>
  async function* (prompt, signal) {
    signal?.throwIfAborted();
    const port = connect();
    // Replies are queued until the loop below takes them
    const queue: PortReply[] = [];
    let closed = false;
    let wake: (() => void) | undefined;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    // Disconnecting throws once the extension is reloaded under the tab (the port is gone by then anyway)
    const disconnect = () => {
      try {
        port.disconnect();
      } catch {}
    };
    port.onMessage.addListener((message) => {
      queue.push(message as PortReply);
      notify();
    });
    port.onDisconnect.addListener(() => {
      closed = true;
      notify();
    });
    const onAbort = () => {
      disconnect();
      closed = true;
      notify();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    port.postMessage({ prompt } satisfies PortRequest);
    try {
      for (;;) {
        const reply = queue.shift();
        if (reply) {
          if ('delta' in reply) yield reply.delta;
          else if ('done' in reply) return;
          else throw new ProviderError(reply.error.code, reply.error.message);
          continue;
        }
        signal?.throwIfAborted();
        // The background service worker stopped or the extension was reloaded
        if (closed) throw new ProviderError('port_closed', 'The connection to the extension was lost');
        await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (!closed) disconnect();
    }
  };

// Background side: answers one request on the port with stream
export const servePort = (port: PortLike, stream: StreamFn) => {
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message) => {
    const prompt = (message as PortRequest)?.prompt;
    if (typeof prompt !== 'string') return;
    const post = (reply: PortReply) => {
      if (!controller.signal.aborted) port.postMessage(reply);
    };
    try {
      for await (const delta of stream(prompt, controller.signal)) post({ delta });
      post({ done: true });
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'translation_failed';
      const text = error instanceof Error ? error.message : String(error);
      post({ error: { code, message: text } });
    }
  });
};
