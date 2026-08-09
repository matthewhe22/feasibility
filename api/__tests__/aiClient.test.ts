/**
 * Tests for the shared AI research client's Gemini grounding path.
 *
 * Run with:  npx tsx api/__tests__/aiClient.test.ts
 *
 * The case that matters here is the one that produced "Google Gemini quota /
 * rate limit reached" in the field: Gemini's Google-Search grounding tool has
 * its own scarce free-tier quota, and when it is refused the request is retried
 * WITHOUT the tool. That retry used to run blind on training data even where a
 * Firecrawl/Tavily key was configured; it now takes injected search results
 * instead, via `groundingFallback`.
 *
 * The Google SDK is exercised through a stubbed global fetch — the grounded call
 * (identified by `tools` in the request body) is made to 429 so the fallback path
 * runs for real.
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { runAIResearch, AIResearchError } from '../_lib/aiClient';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

const realFetch = globalThis.fetch;

interface SentRequest { grounded: boolean; prompt: string; }

/**
 * Stub Gemini's HTTP endpoint. `groundedStatus` is returned for the call that
 * carries the googleSearch tool, letting a test simulate the grounding quota
 * being exhausted while the plain model still answers.
 */
function stubGemini(opts: { groundedStatus: number; text: string }): SentRequest[] {
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const grounded = Array.isArray(body.tools) && body.tools.length > 0;
    const prompt = body.contents?.[0]?.parts?.[0]?.text ?? '';
    sent.push({ grounded, prompt });

    if (grounded && opts.groundedStatus !== 200) {
      const payload = { error: { code: opts.groundedStatus, message: 'RESOURCE_EXHAUSTED: grounding quota', status: 'RESOURCE_EXHAUSTED' } };
      return {
        ok: false,
        status: opts.groundedStatus,
        statusText: 'Too Many Requests',
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as Response;
    }
    const payload = {
      candidates: [{ content: { role: 'model', parts: [{ text: opts.text }] }, finishReason: 'STOP', index: 0 }],
    };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  }) as typeof fetch;
  return sent;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

const base = {
  provider: 'gemini' as const,
  model: 'gemini-2-0-flash',
  apiKey: 'test-key',
  systemPrompt: 'system',
  userPrompt: 'base user prompt',
};

const OK_JSON = '{"summary":"ok","sources":[]}';

async function run() {
  console.log('\nGEMINI GROUNDING FALLBACK');

  // Grounding succeeds → one call, tool attached, fallback never consulted.
  let sent = stubGemini({ groundedStatus: 200, text: OK_JSON });
  let fallbackCalls = 0;
  let result = await runAIResearch({
    ...base,
    useGrounding: true,
    groundingFallback: async () => { fallbackCalls++; return 'INJECTED BLOCK'; },
  });
  eq('grounded success makes one call', sent.length, 1);
  check('grounded success uses the search tool', sent[0].grounded);
  eq('grounded success spends no web search', fallbackCalls, 0);
  check('grounded success reports groundingUsed', result.groundingUsed);

  // Grounding refused (429 on the tool) → retried without it, and the injected
  // results go into that retry rather than it running blind. This is the exact
  // path a configured Firecrawl key was previously ignored on.
  sent = stubGemini({ groundedStatus: 429, text: OK_JSON });
  fallbackCalls = 0;
  result = await runAIResearch({
    ...base,
    useGrounding: true,
    groundingFallback: async () => { fallbackCalls++; return 'INJECTED BLOCK'; },
  });
  eq('refused grounding retries once', sent.length, 2);
  check('retry drops the search tool', !sent[1].grounded);
  eq('retry consults the search tool exactly once', fallbackCalls, 1);
  check('retry carries the injected results', sent[1].prompt.includes('INJECTED BLOCK'));
  check('retry keeps the original prompt', sent[1].prompt.includes('base user prompt'));
  check('native grounding reported as unused', result.groundingUsed === false);

  // No search tool configured → the retry still happens, just ungrounded. The
  // request must not fail because there was nothing to inject.
  sent = stubGemini({ groundedStatus: 429, text: OK_JSON });
  result = await runAIResearch({ ...base, useGrounding: true, groundingFallback: async () => null });
  eq('null fallback still retries', sent.length, 2);
  eq('null fallback leaves the prompt untouched', sent[1].prompt, 'base user prompt');
  check('null fallback still returns a result', result.json.summary === 'ok');

  // Admin turned native grounding off → straight to the plain call, no tool, no
  // fallback (the caller has already grounded the prompt with Firecrawl/Tavily).
  sent = stubGemini({ groundedStatus: 200, text: OK_JSON });
  fallbackCalls = 0;
  await runAIResearch({
    ...base,
    useGrounding: false,
    groundingFallback: async () => { fallbackCalls++; return 'INJECTED BLOCK'; },
  });
  eq('grounding off makes one call', sent.length, 1);
  check('grounding off attaches no tool', !sent[0].grounded);
  eq('grounding off does not use the mid-call fallback', fallbackCalls, 0);

  console.log('\nGEMINI ERROR MAPPING');

  // Both calls 429 → surfaced as a 429 so the endpoint can fail over.
  globalThis.fetch = (async () => {
    const payload = { error: { code: 429, message: 'RESOURCE_EXHAUSTED: quota', status: 'RESOURCE_EXHAUSTED' } };
    return { ok: false, status: 429, statusText: 'Too Many Requests', json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
  }) as typeof fetch;
  let status = 0;
  let message = '';
  try {
    await runAIResearch({ ...base, useGrounding: true, groundingFallback: async () => 'INJECTED BLOCK' });
  } catch (e) {
    status = e instanceof AIResearchError ? e.status : -1;
    message = e instanceof Error ? e.message : '';
  }
  eq('exhausted quota maps to 429', status, 429);
  check('429 message names the quota', /quota|rate limit/i.test(message), message);

  restoreFetch();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`AI CLIENT TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log('═'.repeat(60));
  if (failed > 0) process.exit(1);
}

run().catch(e => {
  restoreFetch();
  console.error('Test run threw:', e);
  process.exit(1);
});
