// The model benchmark: translates the same real captions (bench-data/captions.json) with each model the signed-in
// account can use, and measures the time to the first translated line, the tokens and the translations themselves.
// Included in development builds (`pnpm build`) when bench-data/captions.json is there, never in release builds; open
// chrome-extension://<id>/bench.html after loading dist/.

import { STORAGE_KEYS, type Tokens } from '../core/chatgpt-auth.ts';
import { API, responseDeltas, responseRequestBody, type ReasoningEffort, type Usage } from '../core/chatgpt-responses.ts';
import { ProviderError } from '../core/errors.ts';
import { benchCases, EFFORTS, summarize, type BenchCase, type Fixture, type RunResult } from '../core/model-bench.ts';
import { createLineParser } from '../core/prompt.ts';
import { sessionStore } from '../shared/chrome-store.ts';
import { PROMPTS, type PromptName } from './prompts.ts';

const LANGUAGES = { source: 'en', target: 'ja' };
const TIMEOUT_MS = 60_000;
// For the estimate shown before running: about 4 ASCII characters or 1 other character per token, and the 10 lines of
// Japanese that come back
const roughTokens = (text: string) => {
  const ascii = [...text].filter((char) => char.charCodeAt(0) < 128).length;
  return Math.round(ascii / 4 + (text.length - ascii));
};
const OUTPUT_TOKENS = 250;

type CatalogModel = { slug: string; display_name?: string; visibility?: string };
type Config = { model: string; effort: ReasoningEffort; prompt: PromptName };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setStatus = (text: string) => ($('status').textContent = text);
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Only the background refreshes the access token: a refresh token works once, and two refreshes at the same time
// would sign the user out. Its warmup refreshes a token about to expire, and this page then only reads the stored one.
const accessToken = async (): Promise<string> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await chrome.runtime.sendMessage({ type: 'warmup' });
    const tokens = await sessionStore().get<Tokens>(STORAGE_KEYS.tokens);
    if (!tokens) throw new Error('Not signed in, or locked: sign in or unlock from the popup first');
    if (tokens.expiresAt - Date.now() > 30_000) return tokens.accessToken;
  }
  throw new Error('The access token was not refreshed');
};

// The error's code, parameter and message (cut short), which tell why a model or an effort was refused
const errorOf = async (response: Response) => {
  const error = (await response.json().catch(() => ({})))?.error ?? {};
  return [error.code ?? `http_${response.status}`, error.param, String(error.message ?? '').slice(0, 200)]
    .filter(Boolean)
    .join(' | ');
};

const runCase = async (token: string, { model, effort, prompt }: Config, benchCase: BenchCase): Promise<RunResult> => {
  const result: RunResult = { model, effort, prompt, caseId: benchCase.id, ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);
  const parser = createLineParser(benchCase.lines.length, () => (result.firstLineMs ??= since()));
  try {
    const response = await fetch(`${API}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(responseRequestBody(PROMPTS[prompt](benchCase.lines, benchCase.context, LANGUAGES), { model, effort })),
      signal: controller.signal,
    });
    result.headersMs = since();
    if (!response.ok) {
      result.status = response.status;
      result.error = await errorOf(response);
      return result;
    }
    let usage: Usage | undefined;
    let text = '';
    for await (const delta of responseDeltas(response.body, (value) => (usage = value))) {
      result.firstTextMs ??= since();
      text += delta;
      parser.feed(delta);
    }
    Object.assign(result, { ok: true, totalMs: since(), usage, text, translations: parser.end() });
  } catch (error) {
    result.error = controller.signal.aborted ? 'timeout' : error instanceof ProviderError ? error.code : messageOf(error);
  } finally {
    clearTimeout(timer);
  }
  return result;
};

// Usage limits and a lost sign-in end the whole run: every later request would fail the same way
const stopsTheRun = (result: RunResult) => /usage|http_401|token:/.test(result.error ?? '');

type RunOptions = { higher: boolean; rounds: number; prompts: PromptName[] };

// Always returns what was measured, even when it stops early, since those requests already counted toward the plan
const run = async (fixture: Fixture, models: string[], { higher, rounds, prompts }: RunOptions) => {
  const cases = benchCases(fixture);
  const results: RunResult[] = [];
  let stopped = false;
  const measure = async (config: Config, benchCase: BenchCase) => {
    let result: RunResult;
    try {
      result = await runCase(await accessToken(), config, benchCase);
    } catch (error) {
      result = { ...config, caseId: benchCase.id, ok: false, error: `token: ${messageOf(error)}` };
    }
    results.push(result);
    if (stopsTheRun(result)) stopped = true;
    return result;
  };
  // Opens this page's own connection first, so the first model measured doesn't pay for the TLS handshake
  await fetch(`${API}/models`, { method: 'HEAD' }).catch(() => {});

  // The lowest effort each model accepts, measured on the first case with the first prompt. Only a refusal (400)
  // moves on to the next effort; a timeout or a dropped stream is tried once more at the same effort.
  const configs: Config[] = [];
  for (const model of models) {
    for (const [i, effort] of EFFORTS.entries()) {
      if (stopped) break;
      setStatus(`${model}: trying reasoning effort "${effort}"…`);
      const config = { model, effort, prompt: prompts[0] };
      let result = await measure(config, cases[0]);
      if (!result.ok && result.status === undefined && !stopped) result = await measure(config, cases[0]);
      if (result.ok) {
        for (const more of [effort, ...(higher ? EFFORTS.slice(i + 1) : [])])
          for (const prompt of prompts) configs.push({ model, effort: more, prompt });
        break;
      }
      if (result.status !== 400) break;
    }
  }

  // Every case with every config, models taking turns so that a slow moment of the network doesn't hit one model
  const measured = (config: Config, caseId: string) =>
    results.some(
      (result) =>
        result.ok && result.model === config.model && result.effort === config.effort && result.prompt === config.prompt && result.caseId === caseId
    );
  const total = configs.length * cases.length * rounds;
  let done = configs.filter((config) => measured(config, cases[0].id)).length;
  for (let round = 0; round < rounds && !stopped; round++) {
    for (const benchCase of cases) {
      for (const config of configs) {
        if (stopped) break;
        if (round === 0 && measured(config, benchCase.id)) continue;
        setStatus(`Measuring ${++done} / ${total}: ${config.model} (${config.effort}, ${config.prompt}) on ${benchCase.id}…`);
        await measure(config, benchCase);
      }
    }
  }
  return { cases, results, stopped };
};

const fixed = (value: number | undefined, digits = 0) => (value === undefined ? '–' : value.toFixed(digits));

const showResults = (fixture: Fixture, catalog: CatalogModel[], cases: BenchCase[], results: RunResult[]) => {
  const lines = new Map(cases.map((benchCase) => [benchCase.id, benchCase.lines.length]));
  const summary = summarize(results, (id) => lines.get(id) ?? 0).sort(
    (a, b) => (a.firstLineMs ?? Infinity) - (b.firstLineMs ?? Infinity)
  );

  const table = $('summary');
  table.replaceChildren();
  const head = element('tr');
  for (const title of ['Model', 'Effort', 'Prompt', 'Runs', 'Failed', 'First line ms', 'Total ms', 'In tok', 'Out tok', 'Reasoning tok', 'Tok / line', 'Coverage'])
    head.append(element('th', title));
  table.append(head);
  for (const row of summary) {
    const tr = element('tr');
    tr.append(element('td', row.model), element('td', row.effort), element('td', row.prompt));
    for (const value of [row.runs, row.failures, row.firstLineMs, row.totalMs, row.inputTokens, row.outputTokens, row.reasoningTokens, row.tokensPerLine])
      tr.append(element('td', fixed(value), 'n'));
    tr.append(element('td', row.coverage === undefined ? '–' : `${Math.round(row.coverage * 100)}%`, 'n'));
    table.append(tr);
  }
  const failures = element('ul');
  for (const failure of results.filter((result) => !result.ok))
    failures.append(element('li', `${failure.model} (${failure.effort}, ${failure.prompt}) on ${failure.caseId}: ${failure.error}`));
  $('failures').replaceChildren(failures);

  // Each case side by side: the source, the human translation and each config's first translation
  const configs = summary.filter((row) => row.runs > row.failures);
  const container = $('cases');
  container.replaceChildren();
  for (const benchCase of cases) {
    container.append(element('h2', benchCase.id));
    const caseTable = element('table');
    const header = element('tr');
    for (const title of ['#', 'Source', 'Human', ...configs.map(({ model, effort, prompt }) => `${model} (${effort}, ${prompt})`)])
      header.append(element('th', title));
    caseTable.append(header);
    const firsts = configs.map((config) =>
      results.find(
        (result) =>
          result.ok && result.model === config.model && result.effort === config.effort && result.prompt === config.prompt && result.caseId === benchCase.id
      )
    );
    benchCase.lines.forEach((source, i) => {
      const tr = element('tr');
      tr.append(element('td', String(i + 1), 'n'), element('td', source), element('td', benchCase.refs[i] ?? '', 'ref'));
      for (const first of firsts) {
        const translation = first?.translations?.[i];
        tr.append(translation ? element('td', translation) : element('td', first ? 'missing' : '–', 'missing'));
      }
      caseTable.append(tr);
    });
    container.append(caseTable);
  }

  const report = JSON.stringify(
    { createdAt: new Date().toISOString(), video: fixture.video, title: fixture.title, languages: LANGUAGES, catalog, cases, summary, results },
    null,
    2
  );
  const download = () => {
    const link = element('a');
    link.href = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
    link.download = `jimaku-bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
  };
  $('download').onclick = download;
  $('copy').onclick = () => void navigator.clipboard.writeText(report).then(() => setStatus('Copied the report.'));
  $('results').hidden = false;
  return download;
};

const checkbox = (container: HTMLElement, value: string, checked: boolean, note?: string) => {
  const label = element('label');
  const box = element('input');
  box.type = 'checkbox';
  box.value = value;
  box.checked = checked;
  label.append(box, ` ${value}`);
  if (note) label.append(element('span', ` ${note}`, 'muted'));
  container.append(label);
  return box;
};

const main = async () => {
  const fixture: Fixture = await (await fetch('bench-captions.json')).json();
  const cases = benchCases(fixture);
  const response = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!response.ok) throw new Error(`The model catalog could not be read: ${await errorOf(response)}`);
  const catalog: CatalogModel[] = ((await response.json())?.models ?? []).filter((model: CatalogModel) => typeof model?.slug === 'string');

  // ?models=a,b&prompts=c,d picks the checkboxes (it never starts a run); models=all and models=unlisted pick every
  // model or those ChatGPT doesn't list. Without them, the models ChatGPT lists and the current prompt are picked
  const query = new URLSearchParams(location.search);
  const listed = (name: string) => query.get(name)?.split(',').filter(Boolean);
  const pickedModels = listed('models');
  const pickedPrompts = listed('prompts') ?? ['current'];
  const picks = (model: CatalogModel) => {
    if (!pickedModels) return model.visibility === 'list';
    if (pickedModels.includes('all')) return true;
    if (pickedModels.includes('unlisted') && model.visibility !== 'list') return true;
    return pickedModels.includes(model.slug);
  };
  const modelBoxes = catalog.map((model) =>
    checkbox($('models'), model.slug, picks(model), `${model.display_name ?? ''} (${model.visibility ?? 'no visibility'})`)
  );
  const promptBoxes = (Object.keys(PROMPTS) as PromptName[]).map((name) => checkbox($('prompts'), name, pickedPrompts.includes(name)));
  // ?rounds=n sets how many times every case is measured
  if (query.get('rounds')) $<HTMLInputElement>('rounds').value = query.get('rounds')!;

  const picked = (boxes: HTMLInputElement[]) => boxes.filter((box) => box.checked).map((box) => box.value);
  const options = (): RunOptions => ({
    higher: $<HTMLInputElement>('higher').checked,
    rounds: Math.max(1, Number($<HTMLInputElement>('rounds').value) || 1),
    prompts: picked(promptBoxes) as PromptName[],
  });
  const estimate = () => {
    const { higher, rounds, prompts } = options();
    const repeat = picked(modelBoxes).length * rounds * (higher ? EFFORTS.length : 1);
    const perModel = prompts.reduce(
      (sum, prompt) =>
        sum + cases.reduce((caseSum, c) => caseSum + roughTokens(PROMPTS[prompt](c.lines, c.context, LANGUAGES)) + OUTPUT_TOKENS, 0),
      0
    );
    const requests = repeat * prompts.length * cases.length;
    $('estimate').textContent = `About ${requests} requests (plus a few that fail at once while finding each model's lowest effort), roughly ${(repeat * perModel).toLocaleString()} tokens (${perModel.toLocaleString()} per model and round; reasoning tokens not included).`;
  };
  document.addEventListener('change', estimate);
  estimate();
  setStatus(`${catalog.length} models in this account's catalog, ${cases.length} caption chunks (${LANGUAGES.source} → ${LANGUAGES.target}).`);
  $('setup').hidden = false;

  const button = $<HTMLButtonElement>('run');
  button.addEventListener('click', async () => {
    const models = picked(modelBoxes);
    const chosen = options();
    if (!models.length || !chosen.prompts.length) return setStatus('Pick at least one model and one prompt.');
    button.disabled = true;
    try {
      const { cases: measured, results, stopped } = await run(fixture, models, chosen);
      // The report downloads by itself, so the run needs no more clicks (Download JSON saves it again)
      showResults(fixture, catalog, measured, results)();
      setStatus(`${stopped ? 'Stopped early' : 'Done'}: ${results.length} requests. The report was downloaded (jimaku-bench-….json).`);
    } catch (error) {
      setStatus(`The run failed: ${messageOf(error)}`);
    } finally {
      button.disabled = false;
    }
  });
};

main().catch((error) => setStatus(`Could not start: ${messageOf(error)}`));
