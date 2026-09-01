/**
 * Tests for provider-chain resolution and the settings defaults.
 *
 * Run with:  npx tsx api/__tests__/aiSettings.test.ts
 *
 * Covers the two things that decide whether a rate-limited request recovers:
 * which providers end up in the failover chain and WHICH MODEL each of them
 * runs — a backup key is worthless if it fails over onto a paid route the
 * account has no credits for. Also pins the Gemini-grounding default to OFF.
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { resolveProviderChain, type StoredAISettings } from '../_lib/aiSettings';

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

/** Minimal Supabase stand-in returning one `projects` row's `admin` column. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(aiSettings: unknown): any {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { admin: { aiSettings } }, error: null }),
        }),
      }),
    }),
  };
}

/** A stored row as the admin UI would write it, minus anything overridden. */
function stored(over: Partial<StoredAISettings> & Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'gemini',
    model: 'gemini-2-0-flash',
    enabled: true,
    autoFailover: true,
    keys: { gemini: 'gem-key' },
    ...over,
  };
}

// Env keys would add uninvited providers to every chain — clear them so each
// case sees only the providers it declares.
for (const v of ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY',
  'GEMINI_MODEL', 'DEEPSEEK_MODEL', 'OPENROUTER_MODEL', 'NVIDIA_MODEL']) {
  delete process.env[v];
}

async function run() {
  console.log('\nGEMINI GROUNDING DEFAULT (on)');

  // The headline default: a row that never mentions useGrounding DOES use
  // Gemini's own Google-Search tool — Google's index reflects rendered page
  // content, which grounds better than a Firecrawl/Tavily snippet.
  let r = await resolveProviderChain(fakeSupabase(stored()));
  check('unset useGrounding defaults to on', r?.useGrounding === true);

  r = await resolveProviderChain(fakeSupabase(stored({ useGrounding: false })));
  check('explicit false stays off', r?.useGrounding === false);

  r = await resolveProviderChain(fakeSupabase(stored({ useGrounding: true })));
  check('explicit true still opts in', r?.useGrounding === true);

  // No settings row at all (env-only install) — same default.
  r = await resolveProviderChain(fakeSupabase(null));
  check('no stored row → grounding on', r === null || r.useGrounding === true);

  console.log('\nFAILOVER CHAIN ORDER');

  r = await resolveProviderChain(fakeSupabase(stored({
    keys: { gemini: 'gem-key', openrouter: 'or-key', nvidia: 'nv-key' },
  })));
  eq('active provider leads the chain', r?.chain[0].provider, 'gemini');
  eq('active provider keeps its selected model', r?.chain[0].model, 'gemini-2-0-flash');
  eq('every keyed provider is a failover candidate', r?.chain.map(c => c.provider), ['gemini', 'openrouter', 'nvidia']);

  // A provider with no key must never enter the chain — it would only burn an
  // attempt and mask the real error.
  r = await resolveProviderChain(fakeSupabase(stored({ keys: { gemini: 'gem-key' } })));
  eq('keyless providers are excluded', r?.chain.length, 1);

  console.log('\nFAILOVER MODEL SELECTION');

  // openrouter/auto is a variable-priced PAID route: a backup key with no credit
  // balance 402s the moment it is needed. With a catalogue cached, prefer a free
  // model — widest context first, since research prompts are long.
  r = await resolveProviderChain(fakeSupabase(stored({
    keys: { gemini: 'gem-key', openrouter: 'or-key' },
    openrouterModels: [
      { id: 'paid/big-model', label: 'Paid', free: false, contextLength: 1_000_000 },
      { id: 'free/small:free', label: 'Free small', free: true, contextLength: 8_000 },
      { id: 'free/large:free', label: 'Free large', free: true, contextLength: 128_000 },
    ],
  })));
  eq('openrouter failover picks the widest free model', r?.chain[1].model, 'free/large:free');

  // No catalogue cached → nothing better to pick than the documented default.
  r = await resolveProviderChain(fakeSupabase(stored({ keys: { gemini: 'gem-key', openrouter: 'or-key' } })));
  eq('no catalogue → openrouter default', r?.chain[1].model, 'openrouter/auto');

  // A catalogue with no free entries must not silently pick a paid model.
  r = await resolveProviderChain(fakeSupabase(stored({
    keys: { gemini: 'gem-key', openrouter: 'or-key' },
    openrouterModels: [{ id: 'paid/only', label: 'Paid', free: false, contextLength: 200_000 }],
  })));
  eq('paid-only catalogue → openrouter default', r?.chain[1].model, 'openrouter/auto');

  // When OpenRouter is the ACTIVE provider the admin's explicit choice wins,
  // free or paid — the free-model preference is a failover safety net, not a
  // second-guess of a deliberate selection.
  r = await resolveProviderChain(fakeSupabase(stored({
    provider: 'openrouter',
    model: 'paid/chosen-model',
    keys: { openrouter: 'or-key' },
    openrouterModels: [{ id: 'free/large:free', label: 'Free large', free: true, contextLength: 128_000 }],
  })));
  eq('active openrouter keeps the selected model', r?.chain[0].model, 'paid/chosen-model');

  // NVIDIA's default is already a free hosted NIM model.
  r = await resolveProviderChain(fakeSupabase(stored({ keys: { gemini: 'gem-key', nvidia: 'nv-key' } })));
  eq('nvidia failover uses its free default', r?.chain[1].model, 'meta/llama-3.1-8b-instruct');

  // An explicit env model override still wins over both.
  process.env.OPENROUTER_MODEL = 'env/pinned-model';
  r = await resolveProviderChain(fakeSupabase(stored({
    keys: { gemini: 'gem-key', openrouter: 'or-key' },
    openrouterModels: [{ id: 'free/large:free', label: 'Free large', free: true, contextLength: 128_000 }],
  })));
  eq('env model override wins', r?.chain[1].model, 'env/pinned-model');
  delete process.env.OPENROUTER_MODEL;

  console.log('\nDISABLED / EMPTY SETTINGS');

  // enabled=false drops the active provider, but a keyed provider still backs
  // the chain rather than 503-ing the endpoint outright.
  r = await resolveProviderChain(fakeSupabase(stored({ enabled: false, keys: { gemini: 'gem-key' } })));
  eq('disabled settings still expose the keyed provider', r?.chain.map(c => c.provider), ['gemini']);

  // No keys anywhere → null, so the endpoint can return its "not configured"
  // message instead of attempting a keyless call.
  r = await resolveProviderChain(fakeSupabase(stored({ keys: {} })));
  check('no keys anywhere → null chain', r === null);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`AI SETTINGS TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log('═'.repeat(60));
  if (failed > 0) process.exit(1);
}

run().catch(e => {
  console.error('Test run threw:', e);
  process.exit(1);
});
