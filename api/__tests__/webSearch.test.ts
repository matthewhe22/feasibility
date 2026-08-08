/**
 * Tests for the Firecrawl client + web-search orchestrator.
 *
 * Run with:  npx tsx api/__tests__/webSearch.test.ts
 *
 * These cover the parts that cannot be verified against the live API from a
 * sandbox: Firecrawl's version-dependent response shapes, the 404-only retry
 * onto the sibling API version, and the primary/fallback ordering that decides
 * which search tool grounds a request.
 *
 * Lives under a `__tests__` directory so Vercel's function detection skips it —
 * any path segment starting with `_` is excluded, the same rule that keeps
 * `api/_lib/*` from becoming endpoints.
 */
import { firecrawlSearch, FirecrawlError, FIRECRAWL_DEFAULT_SETTINGS } from '../_lib/firecrawl';
import { runWebSearch, webSearchCacheTag, type WebSearchConfig } from '../_lib/webSearch';

// Disable the per-tool query caches so each case starts clean.
process.env.FIRECRAWL_CACHE_TTL_MS = '0';
process.env.TAVILY_CACHE_TTL_MS = '0';

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

/** Stub global fetch with a handler over (url, init). */
function stubFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const { status, body } = handler(url, init ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

const baseSettings = { ...FIRECRAWL_DEFAULT_SETTINGS, apiKey: 'fc-test-key' };

async function run() {
  console.log('\nFIRECRAWL RESPONSE PARSING');

  // v1 shape: data is a flat array.
  stubFetch(() => ({
    status: 200,
    body: { success: true, data: [
      { url: 'https://a.example/report', title: 'Report A', description: 'snippet A' },
      { url: 'https://b.example/report', title: 'Report B', markdown: 'full markdown B' },
    ] },
  }));
  let r = await firecrawlSearch(baseSettings, 'test query');
  eq('v1 flat array → 2 results', r.results.length, 2);
  eq('v1 prefers markdown over description', r.results[1].content, 'full markdown B');
  eq('v1 falls back to description', r.results[0].content, 'snippet A');

  // v2 shape: data is keyed by result category.
  stubFetch(() => ({
    status: 200,
    body: { success: true, data: {
      web: [{ url: 'https://w.example', title: 'Web', description: 'web snippet' }],
      news: [{ url: 'https://n.example', title: 'News', description: 'news snippet' }],
    } },
  }));
  r = await firecrawlSearch(baseSettings, 'test query');
  eq('v2 categorised → merges web + news', r.results.length, 2);
  eq('v2 orders web before news', r.results.map(x => x.title), ['Web', 'News']);

  // Results without a usable url are dropped rather than injected blank.
  stubFetch(() => ({
    status: 200,
    body: { data: [{ title: 'no url' }, { url: '', title: 'blank url' }, { url: 'https://ok.example', title: 'ok' }] },
  }));
  r = await firecrawlSearch(baseSettings, 'q');
  eq('entries without a url are dropped', r.results.map(x => x.url), ['https://ok.example']);

  // Unrecognised shape yields no results instead of throwing.
  stubFetch(() => ({ status: 200, body: { unexpected: true } }));
  r = await firecrawlSearch(baseSettings, 'q');
  eq('unknown shape → empty results, no throw', r.results.length, 0);

  console.log('\nAPI VERSION FALLBACK');

  // A 404 on the configured path retries the sibling version exactly once.
  const tried: string[] = [];
  stubFetch((url) => {
    tried.push(new URL(url).pathname);
    return url.endsWith('/v2/search')
      ? { status: 404, body: 'not found' }
      : { status: 200, body: { data: [{ url: 'https://v1.example', title: 'v1 result' }] } };
  });
  r = await firecrawlSearch({ ...baseSettings, searchPath: '/v2/search' }, 'q');
  eq('404 on v2 retries v1', tried, ['/v2/search', '/v1/search']);
  eq('reports the path that answered', r.pathUsed, '/v1/search');

  // A non-404 error must NOT be retried — the sibling would fail identically.
  const tried2: string[] = [];
  stubFetch((url) => {
    tried2.push(new URL(url).pathname);
    return { status: 500, body: 'server error' };
  });
  let threw = false;
  try {
    await firecrawlSearch({ ...baseSettings, searchPath: '/v2/search' }, 'q');
  } catch (e) {
    threw = e instanceof FirecrawlError;
  }
  check('500 throws FirecrawlError', threw);
  eq('500 is not retried on the sibling path', tried2.length, 1);

  // Credential / quota failures carry their status so the admin UI can react.
  for (const [status, label] of [[401, 'invalid key'], [402, 'no credits'], [429, 'rate limited']] as const) {
    stubFetch(() => ({ status, body: 'nope' }));
    let caught: unknown = null;
    try { await firecrawlSearch(baseSettings, 'q'); } catch (e) { caught = e; }
    check(`HTTP ${status} (${label}) surfaces status`, caught instanceof FirecrawlError && caught.status === status);
  }

  console.log('\nSCRAPE OPTION');

  let sentBody: Record<string, unknown> = {};
  stubFetch((_url, init) => {
    sentBody = JSON.parse(String(init.body));
    return { status: 200, body: { data: [] } };
  });
  await firecrawlSearch({ ...baseSettings, scrapeContent: false }, 'q');
  check('scrapeContent off → no scrapeOptions sent', sentBody.scrapeOptions === undefined);
  await firecrawlSearch({ ...baseSettings, scrapeContent: true }, 'q');
  eq('scrapeContent on → requests markdown', sentBody.scrapeOptions, { formats: ['markdown'] });
  eq('limit tracks maxResults', sentBody.limit, baseSettings.maxResults);

  console.log('\nPRIMARY / FALLBACK ORDERING');

  const firecrawlCfg = { ...baseSettings, source: 'stored' as const };
  const tavilyCfg = { apiKey: 'tvly-test', enabled: true, maxResults: 5, searchDepth: 'basic' as const, source: 'stored' as const };

  const cfg = (over: Partial<WebSearchConfig>): WebSearchConfig => ({
    primary: 'firecrawl',
    fallback: true,
    firecrawl: firecrawlCfg,
    tavily: tavilyCfg,
    ...over,
  });

  // Cache tags must encode order, not just which keys exist — otherwise a
  // Firecrawl-first result could be served to a Tavily-first request.
  eq('cache tag encodes firecrawl-first', webSearchCacheTag(cfg({})), 'firecrawl>tavily');
  eq('cache tag encodes tavily-first', webSearchCacheTag(cfg({ primary: 'tavily' })), 'tavily>firecrawl');
  eq('cache tag omits fallback when off', webSearchCacheTag(cfg({ fallback: false })), 'firecrawl');
  eq('cache tag with no tools', webSearchCacheTag(cfg({ firecrawl: null, tavily: null })), 'none');
  eq('cache tag skips unconfigured primary', webSearchCacheTag(cfg({ firecrawl: null })), 'tavily');

  // Firecrawl answers → it is used, no fallback recorded.
  stubFetch((url) => url.includes('firecrawl')
    ? { status: 200, body: { data: [{ url: 'https://fc.example', title: 'FC', description: 'fc snippet' }] } }
    : { status: 200, body: { results: [{ url: 'https://tv.example', title: 'TV', content: 'tv snippet' }] } });
  let ctx = await runWebSearch(cfg({}), 'query one');
  eq('primary firecrawl answers', ctx?.provider, 'firecrawl');
  check('no fellBackFrom when primary answered', ctx?.fellBackFrom === undefined);

  // Firecrawl returns zero results → falls back to Tavily.
  stubFetch((url) => url.includes('firecrawl')
    ? { status: 200, body: { data: [] } }
    : { status: 200, body: { results: [{ url: 'https://tv.example', title: 'TV', content: 'tv snippet' }] } });
  ctx = await runWebSearch(cfg({}), 'query two');
  eq('empty primary falls back to tavily', ctx?.provider, 'tavily');
  eq('records what it fell back from', ctx?.fellBackFrom, 'firecrawl');

  // Firecrawl errors → falls back rather than failing the request.
  stubFetch((url) => url.includes('firecrawl')
    ? { status: 500, body: 'boom' }
    : { status: 200, body: { results: [{ url: 'https://tv.example', title: 'TV', content: 'tv snippet' }] } });
  ctx = await runWebSearch(cfg({}), 'query three');
  eq('erroring primary falls back to tavily', ctx?.provider, 'tavily');

  // Fallback disabled → a failing primary yields nothing, and critically must
  // NOT spend credits on the other service.
  const hosts: string[] = [];
  stubFetch((url) => {
    hosts.push(new URL(url).host);
    return { status: 200, body: { data: [] } };
  });
  ctx = await runWebSearch(cfg({ fallback: false }), 'query four');
  check('fallback off → no context', ctx === null);
  check('fallback off → tavily never called', hosts.every(h => h.includes('firecrawl')));

  // Tavily-first honours the inverted order.
  stubFetch((url) => url.includes('firecrawl')
    ? { status: 200, body: { data: [{ url: 'https://fc.example', title: 'FC', description: 'fc' }] } }
    : { status: 200, body: { results: [{ url: 'https://tv.example', title: 'TV', content: 'tv' }] } });
  ctx = await runWebSearch(cfg({ primary: 'tavily' }), 'query five');
  eq('tavily-first uses tavily', ctx?.provider, 'tavily');

  // Nothing configured → null, no crash.
  ctx = await runWebSearch(cfg({ firecrawl: null, tavily: null }), 'query six');
  check('no tools configured → null', ctx === null);

  // An empty query must not spend a search.
  const hosts2: string[] = [];
  stubFetch((url) => { hosts2.push(url); return { status: 200, body: { data: [] } }; });
  ctx = await runWebSearch(cfg({}), '   ');
  check('blank query → null', ctx === null);
  eq('blank query performs no search', hosts2.length, 0);

  restoreFetch();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`WEB SEARCH TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log('═'.repeat(60));
  if (failed > 0) process.exit(1);
}

run().catch(e => {
  restoreFetch();
  console.error('Test run threw:', e);
  process.exit(1);
});
