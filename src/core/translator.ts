// The pluggable translator interface. The main one (ChatGPT plan / SIWC), the fallback (Claude API) and the mock all implement this shape.
// Calling a real API from the content script is blocked by CORS, so an implementation lives in the background
// service worker and streams to the content script over a port (port-stream.ts).
//
// To shorten TTFT (time until the first translation is visible), each translated line is reported through onLine.
// When choosing a real translator, use a model with a short TTFT and turn reasoning off (none / minimal).

export type ContextLine = {
  source: string;
  // undefined for lines not yet translated
  translation?: string;
};

export type TranslationContext = {
  title?: string;
  // Lines shown just before the lines to translate (oldest first)
  before: ContextLine[];
  // Lines shown just after the lines to translate (source only)
  after: string[];
};

export type TranslateOptions = {
  // Called as soon as the translation of lines[index] is ready
  onLine?: (index: number, translation: string) => void;
  signal?: AbortSignal;
};

export type Translator = {
  // Returns an array as long as lines. Lines with no translation in the response are undefined.
  translate(lines: string[], context: TranslationContext, options?: TranslateOptions): Promise<(string | undefined)[]>;
  // Called when a video opens, for example. A real translator sets up its connection or preflight here
  // to cut the wait on the first request.
  warmup?(): void;
};
