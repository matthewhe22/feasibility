import { useEffect, useMemo, useState } from 'react';
import {
  fetchAISettings,
  updateAISettings,
  deleteStoredAIKey,
  refreshOpenRouterModels,
  refreshNvidiaModels,
  testAIProvider,
  type AISettings,
  type AIProvider,
  type AIModelOption,
  type WebSearchProvider,
} from './api';

interface ProviderInfo {
  label: string;
  apiKeyUrl: string;
  apiKeyLabel: string;
  description: string;
  keyPlaceholder: string;
}

const PROVIDERS: Record<AIProvider, ProviderInfo> = {
  gemini: {
    label: 'Google Gemini',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    apiKeyLabel: 'aistudio.google.com/apikey',
    description: 'Free tier on 2.0 Flash. Live web search via Google Search grounding.',
    keyPlaceholder: '(paste your Gemini API key)',
  },
  deepseek: {
    label: 'DeepSeek',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    apiKeyLabel: 'platform.deepseek.com/api_keys',
    description: 'Very low cost, pay-as-you-go. No built-in web search.',
    keyPlaceholder: 'sk-...',
  },
  openrouter: {
    label: 'OpenRouter',
    apiKeyUrl: 'https://openrouter.ai/keys',
    apiKeyLabel: 'openrouter.ai/keys',
    description: 'One key, hundreds of models — free and paid. Use "Update models" to load the full catalogue, then filter/search it below. Most models have no live web search.',
    keyPlaceholder: 'sk-or-v1-...',
  },
  nvidia: {
    label: 'NVIDIA',
    apiKeyUrl: 'https://build.nvidia.com/',
    apiKeyLabel: 'build.nvidia.com',
    description: 'Free hosted NIM models (Llama, Nemotron, DeepSeek, Qwen, etc.) for development. Use "Update models" to load the catalogue. No live web search.',
    keyPlaceholder: 'nvapi-...',
  },
};

const PROVIDER_ORDER: AIProvider[] = ['gemini', 'deepseek', 'openrouter', 'nvidia'];

/** Providers whose model list is fetched dynamically (vs a static curated set). */
const DYNAMIC_PROVIDERS: AIProvider[] = ['openrouter', 'nvidia'];
const isDynamic = (p: AIProvider) => DYNAMIC_PROVIDERS.includes(p);

/** Short price label for a dynamic model, e.g. "free" or "$3.00/M in · $15.00/M out".
 *  A paid-tier model with no reported price (OpenRouter returns "-1" for
 *  variable-priced routes such as openrouter/auto) is labelled accordingly. */
function priceLabel(opt: AIModelOption): string {
  if (opt.tier === 'free') return 'free';
  if (opt.inputPricePerMillion === 0 && opt.outputPricePerMillion === 0) return 'variable pricing';
  const fmt = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
  return `${fmt(opt.inputPricePerMillion)}/M in · ${fmt(opt.outputPricePerMillion)}/M out`;
}

export function AISettingsPage() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [model, setModel] = useState<string>('gemini-2-0-flash');
  const [enabled, setEnabled] = useState(true);
  // Default ON: Google's own index reflects rendered page content, which grounds
  // property research better than Firecrawl/Tavily snippets. Firecrawl/Tavily
  // still ground every other provider in the failover chain regardless.
  const [useGrounding, setUseGrounding] = useState(true);
  const [autoFailover, setAutoFailover] = useState(true);
  const [webSearchPrimary, setWebSearchPrimary] = useState<WebSearchProvider>('firecrawl');
  const [webSearchFallback, setWebSearchFallback] = useState(true);
  // Per-provider draft key replacements (blank = keep stored).
  const [keyInputs, setKeyInputs] = useState<Record<AIProvider, string>>({ gemini: '', deepseek: '', openrouter: '', nvidia: '' });
  const [showKey, setShowKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testStatus, setTestStatus] = useState<{ type: 'ok' | 'err' | 'running'; text: string } | null>(null);
  // Per-provider key test (independent of the saved/active settings).
  const [providerTest, setProviderTest] = useState<{ type: 'ok' | 'err' | 'running'; text: string } | null>(null);
  const [orRefreshing, setOrRefreshing] = useState(false);
  const [orMsg, setOrMsg] = useState<string | null>(null);
  // Dynamic-catalogue browsing (OpenRouter is hundreds of models).
  const [modelSearch, setModelSearch] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAISettings()
      .then(s => {
        if (cancelled) return;
        setSettings(s);
        setProvider(s.provider);
        setModel(s.model);
        setEnabled(s.enabled);
        setUseGrounding(s.useGrounding);
        setAutoFailover(s.autoFailover);
        setWebSearchPrimary(s.webSearchPrimary ?? 'firecrawl');
        setWebSearchFallback(s.webSearchFallback ?? true);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, []);

  // Dynamic catalogue (OpenRouter / NVIDIA) for the given provider, else [].
  const dynamicModelsFor = (s: AISettings, p: AIProvider) =>
    p === 'openrouter' ? s.openrouterModels : p === 'nvidia' ? s.nvidiaModels : [];

  const modelOptions: AIModelOption[] = useMemo(() => {
    if (!settings) return [];
    if (DYNAMIC_PROVIDERS.includes(provider)) {
      return dynamicModelsFor(settings, provider).map(m => ({
        id: m.id,
        label: m.label,
        provider,
        tier: (m.free ? 'free' : 'paid') as 'free' | 'paid',
        contextWindow: m.contextLength ? `${Math.round(m.contextLength / 1000)}K` : '—',
        inputPricePerMillion: m.inputPricePerMillion ?? 0,
        outputPricePerMillion: m.outputPricePerMillion ?? 0,
        supportsWebSearch: false,
        recommendedFor: provider === 'nvidia'
          ? 'NVIDIA hosted model (free dev tier).'
          : m.free ? 'OpenRouter free model.' : 'OpenRouter paid model — billed to your OpenRouter credit.',
      }));
    }
    return settings.allowedModels.filter(m => m.provider === provider);
  }, [settings, provider]);

  /** Free/paid + text filter over the dynamic catalogue. The currently selected
   *  model is always kept in the list so a filter can never silently drop it. */
  const visibleModelOptions: AIModelOption[] = useMemo(() => {
    if (!isDynamic(provider)) return modelOptions;
    const q = modelSearch.trim().toLowerCase();
    const filtered = modelOptions.filter(m => {
      if (m.id === model) return true;
      if (freeOnly && m.tier !== 'free') return false;
      if (!q) return true;
      return m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    });
    return filtered;
  }, [modelOptions, provider, model, modelSearch, freeOnly]);

  const freeModelCount = useMemo(() => modelOptions.filter(m => m.tier === 'free').length, [modelOptions]);

  // When switching provider, snap the model to a valid one for that provider.
  function selectProvider(p: AIProvider) {
    setProvider(p);
    setProviderTest(null);
    setOrMsg(null);
    setModelSearch('');
    if (!settings) return;
    const opts = DYNAMIC_PROVIDERS.includes(p)
      ? dynamicModelsFor(settings, p).map(m => m.id)
      : settings.allowedModels.filter(m => m.provider === p).map(m => m.id);
    if (!opts.includes(model)) setModel(opts[0] ?? '');
  }

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const keys: Partial<Record<AIProvider, string>> = {};
      for (const p of PROVIDER_ORDER) if (keyInputs[p].trim()) keys[p] = keyInputs[p].trim();
      const patch = { provider, model, enabled, useGrounding, autoFailover, webSearchPrimary, webSearchFallback, ...(Object.keys(keys).length ? { keys } : {}) };
      await updateAISettings(patch);
      // Refetch to get fresh previews / providers status.
      const fresh = await fetchAISettings();
      setSettings(fresh);
      setKeyInputs({ gemini: '', deepseek: '', openrouter: '', nvidia: '' });
      setShowKey(false);
      setSaveMsg({ type: 'ok', text: 'Settings saved.' });
    } catch (e) {
      setSaveMsg({ type: 'err', text: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async (p: AIProvider) => {
    if (!confirm(`Remove the stored ${PROVIDERS[p].label} key? The provider's env-var fallback (if any) still applies.`)) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await deleteStoredAIKey(p);
      const fresh = await fetchAISettings();
      setSettings(fresh);
      setSaveMsg({ type: 'ok', text: `${PROVIDERS[p].label} key removed.` });
    } catch (e) {
      setSaveMsg({ type: 'err', text: e instanceof Error ? e.message : 'Remove failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestProvider = async () => {
    setProviderTest({ type: 'running', text: `Testing ${PROVIDERS[provider].label}…` });
    try {
      const args: { provider: AIProvider; model?: string; key?: string } = { provider };
      if (model) args.model = model;
      const draft = keyInputs[provider].trim();
      if (draft) args.key = draft;
      const r = await testAIProvider(args);
      setProviderTest({ type: 'ok', text: r.message });
    } catch (e) {
      setProviderTest({ type: 'err', text: e instanceof Error ? e.message : 'Test failed.' });
    }
  };

  // Refresh the dynamic model list for the active provider (OpenRouter / NVIDIA).
  const handleRefreshDynamicModels = async () => {
    setOrRefreshing(true);
    setOrMsg(null);
    try {
      const r = provider === 'nvidia' ? await refreshNvidiaModels() : await refreshOpenRouterModels();
      setSettings(s => s
        ? (provider === 'nvidia'
            ? { ...s, nvidiaModels: r.models, nvidiaModelsUpdatedAt: r.updatedAt }
            : { ...s, openrouterModels: r.models, openrouterModelsUpdatedAt: r.updatedAt })
        : s);
      // If the current selection is no longer valid, pick the first model.
      if (!r.models.some(m => m.id === model)) setModel(r.models[0]?.id ?? '');
      const stale = provider === 'nvidia' ? (r as { staleDefaults?: string[] }).staleDefaults ?? [] : [];
      const free = (r as { freeCount?: number }).freeCount;
      const loaded = provider === 'openrouter' && typeof free === 'number'
        ? `Loaded ${r.count} models (${free} free, ${r.count - free} paid).`
        : `Loaded ${r.count} models.`;
      setOrMsg(stale.length
        ? `${loaded} ${stale.length} curated default(s) retired/renamed (now using the live list): ${stale.join(', ')}.`
        : loaded);
    } catch (e) {
      setOrMsg(e instanceof Error ? e.message : 'Failed to refresh models.');
    } finally {
      setOrRefreshing(false);
    }
  };

  const handleTest = async () => {
    setTestStatus({ type: 'running', text: 'Running a small benchmark research request with the saved settings…' });
    try {
      const r = await fetch('/api/benchmarks/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'construction', buildingType: 'High-rise apartments (15+ storeys)', storeys: 20, state: 'NSW', finishQuality: 'standard', siteComplexity: 'moderate', gfa: 10000, refresh: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      setTestStatus({ type: 'ok', text: `Success — $${data.rateLow?.toLocaleString?.()}–$${data.rateHigh?.toLocaleString?.()} /m² from ${data.provider}/${data.model}.` });
    } catch (e) {
      setTestStatus({ type: 'err', text: e instanceof Error ? e.message : 'Test failed.' });
    }
  };

  if (loadError) {
    return <div><Header /><p className="text-sm text-red-300 bg-red-900/40 border border-red-700 rounded px-4 py-2.5">Failed to load AI settings: {loadError}</p></div>;
  }
  if (!settings) {
    return <div><Header /><p className="text-sm text-gray-400">Loading…</p></div>;
  }

  const providerStatus = settings.providers.find(p => p.provider === provider);
  const info = PROVIDERS[provider];
  const isDynamicProvider = DYNAMIC_PROVIDERS.includes(provider);
  const dynamicUpdatedAt = provider === 'nvidia' ? settings.nvidiaModelsUpdatedAt : settings.openrouterModelsUpdatedAt;
  const dirty =
    provider !== settings.provider || model !== settings.model || enabled !== settings.enabled ||
    useGrounding !== settings.useGrounding || autoFailover !== settings.autoFailover ||
    webSearchPrimary !== settings.webSearchPrimary || webSearchFallback !== settings.webSearchFallback ||
    PROVIDER_ORDER.some(p => keyInputs[p].trim() !== '');

  return (
    <div>
      <Header />
      <StatusBanner settings={settings} />

      <div className="space-y-6">
        {/* Provider selector */}
        <Card title="Provider">
          <p className="text-xs text-gray-400 mb-3">
            Store a key for each provider once, then switch freely. The active provider + model is used for every
            "Research benchmarks" / RV Research request.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {PROVIDER_ORDER.map(p => {
              const st = settings.providers.find(x => x.provider === p);
              const active = provider === p;
              return (
                <button key={p} onClick={() => selectProvider(p)}
                  className={`text-left p-3 rounded border transition-colors ${active ? 'bg-blue-900/40 border-blue-500 ring-2 ring-blue-500/40' : 'bg-gray-900/40 border-gray-700 hover:bg-gray-800'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{PROVIDERS[p].label}</span>
                    {st?.hasKey
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-900/40 border-green-700 text-green-300">key set</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-700/40 border-gray-600 text-gray-400">no key</span>}
                  </div>
                  {p === settings.provider && <span className="text-[10px] text-blue-300">active</span>}
                </button>
              );
            })}
          </div>
        </Card>

        {/* API key for selected provider */}
        <Card title={`${info.label} API Key`}>
          <p className="text-xs text-gray-400 mb-3">
            Get a key from <a className="text-blue-400 underline" target="_blank" rel="noopener" href={info.apiKeyUrl}>{info.apiKeyLabel}</a>.
            {' '}{info.description} Keys are stored encrypted in the database and only ever read on the server.
          </p>

          {providerStatus?.hasStoredKey && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span className="text-gray-400">Stored key:</span>
              <code className="px-2 py-0.5 bg-gray-900 border border-gray-700 rounded text-blue-300 font-mono text-xs">{providerStatus.keyPreview || '***'}</code>
              <button onClick={() => handleRemoveKey(provider)} disabled={saving} className="ml-auto text-xs bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white px-2 py-1 rounded">Remove</button>
            </div>
          )}
          {!providerStatus?.hasStoredKey && providerStatus?.hasEnvFallback && (
            <p className="text-[11px] text-blue-300 mb-2">Using an env-var fallback key for this provider.</p>
          )}

          <label className="block text-xs font-semibold text-gray-300 mb-1">
            {providerStatus?.hasStoredKey ? 'Replace key (leave blank to keep current)' : `Set ${info.label} API key`}
          </label>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInputs[provider]}
              onChange={e => setKeyInputs(k => ({ ...k, [provider]: e.target.value }))}
              placeholder={info.keyPlaceholder}
              autoComplete="off" spellCheck={false}
              className="flex-1 text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
            />
            <button type="button" onClick={() => setShowKey(s => !s)} className="text-xs bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 px-2 py-2 rounded">{showKey ? 'Hide' : 'Show'}</button>
            <button
              type="button"
              onClick={handleTestProvider}
              disabled={providerTest?.type === 'running' || (!providerStatus?.hasKey && !keyInputs[provider].trim())}
              className="text-xs bg-purple-700 hover:bg-purple-800 disabled:opacity-40 text-white px-2 py-2 rounded whitespace-nowrap"
            >
              {providerTest?.type === 'running' ? 'Testing…' : 'Test this key'}
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5">
            "Test this key" verifies {info.label} directly — using the key typed above if present, otherwise the stored key — without saving.
          </p>
          {providerTest && providerTest.type !== 'running' && (
            <div className={`mt-2 p-2 rounded text-xs ${providerTest.type === 'ok' ? 'bg-green-900/40 border border-green-700 text-green-300' : 'bg-red-900/40 border border-red-700 text-red-300'}`}>
              <span className="font-semibold">{providerTest.type === 'ok' ? '✓ ' : '✗ '}</span>{providerTest.text}
            </div>
          )}
        </Card>

        {/* Model selector */}
        <Card title="Model">
          {isDynamicProvider && (
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <button onClick={handleRefreshDynamicModels} disabled={orRefreshing} className="text-xs bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white px-3 py-1.5 rounded font-medium">
                {orRefreshing ? 'Updating…' : 'Update models'}
              </button>
              {dynamicUpdatedAt && (
                <span className="text-[10px] text-gray-500">Last updated {new Date(dynamicUpdatedAt).toLocaleString()}</span>
              )}
              {orMsg && <span className="text-[10px] text-gray-300">{orMsg}</span>}
            </div>
          )}

          {modelOptions.length === 0 ? (
            <p className="text-xs text-gray-400">
              {provider === 'nvidia'
                ? 'No models loaded yet — save an NVIDIA key, then click "Update models" to fetch NVIDIA\'s hosted catalogue.'
                : provider === 'openrouter'
                  ? 'No models loaded yet — click "Update models" to fetch OpenRouter\'s full model catalogue (free + paid).'
                  : 'No models available.'}
            </p>
          ) : isDynamicProvider ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="search"
                  value={modelSearch}
                  onChange={e => setModelSearch(e.target.value)}
                  placeholder="Search models by name or id…"
                  autoComplete="off" spellCheck={false}
                  className="flex-1 min-w-[12rem] text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
                />
                {provider === 'openrouter' && (
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer whitespace-nowrap">
                    <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} className="w-4 h-4" />
                    Free models only
                  </label>
                )}
              </div>
              <select value={model} onChange={e => setModel(e.target.value)} size={Math.min(12, Math.max(4, visibleModelOptions.length))}
                className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500">
                {visibleModelOptions.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.contextWindow} · {priceLabel(m)}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-500">
                Showing {visibleModelOptions.length} of {modelOptions.length} models
                {provider === 'openrouter' && <> ({freeModelCount} free, {modelOptions.length - freeModelCount} paid)</>}.
                {' '}Selected: <code className="font-mono text-gray-400">{model || '—'}</code>
                {provider === 'openrouter' && !freeOnly && (
                  <> · Paid models are billed to your OpenRouter credit balance.</>
                )}
              </p>
              {visibleModelOptions.length === 0 && (
                <p className="text-[11px] text-amber-300">No models match the current filter.</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {modelOptions.map(opt => <ModelOption key={opt.id} option={opt} selected={model === opt.id} onSelect={() => setModel(opt.id)} />)}
            </div>
          )}
        </Card>

        {/* Web search grounding */}
        <Card title="Web search grounding">
          <p className="text-xs text-gray-400 mb-3">
            Gemini is the only provider with its own live web search. For every other provider
            (DeepSeek / OpenRouter / NVIDIA) research is grounded by running a web search and injecting the results into
            the prompt. Choose which tool runs first — keys are configured under
            {' '}<strong className="text-gray-300">Firecrawl Search</strong> and <strong className="text-gray-300">Tavily Search</strong>.
          </p>

          <label className="block text-xs font-semibold text-gray-300 mb-1">Primary search tool</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            {(['firecrawl', 'tavily'] as WebSearchProvider[]).map(p => {
              const active = webSearchPrimary === p;
              const meta = p === 'firecrawl'
                ? { label: 'Firecrawl', blurb: 'Search + optional full-page scrape — richer grounding for figures buried in report bodies.' }
                : { label: 'Tavily', blurb: 'LLM-oriented search with a synthesised answer. Cheaper per query, snippets only.' };
              return (
                <button key={p} type="button" onClick={() => setWebSearchPrimary(p)}
                  className={`text-left p-3 rounded border transition-colors ${active ? 'bg-blue-900/40 border-blue-500 ring-2 ring-blue-500/40' : 'bg-gray-900/40 border-gray-700 hover:bg-gray-800'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{meta.label}</span>
                    {p === 'firecrawl' && <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/40 border-emerald-700 text-emerald-300">default</span>}
                  </div>
                  <span className="block text-[11px] text-gray-400 mt-0.5">{meta.blurb}</span>
                </button>
              );
            })}
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={webSearchFallback} onChange={e => setWebSearchFallback(e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span className="text-sm text-gray-200">Fall back to the other tool
              <span className="block text-xs text-gray-500 mt-0.5">
                When the primary tool has no key, errors, or returns no results, retry the search with
                {' '}{webSearchPrimary === 'firecrawl' ? 'Tavily' : 'Firecrawl'}. Turn off to use
                {' '}{webSearchPrimary === 'firecrawl' ? 'Firecrawl' : 'Tavily'} exclusively — research then runs ungrounded
                if it fails, rather than spending credits on the other service.
              </span>
            </span>
          </label>
        </Card>

        {/* Quota & reliability */}
        <Card title="Quota & reliability">
          <label className="flex items-start gap-3 cursor-pointer mb-3">
            <input type="checkbox" checked={useGrounding} onChange={e => setUseGrounding(e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span className="text-sm text-gray-200">Use Google Search grounding (Gemini)
              <span className="block text-xs text-gray-500 mt-0.5">
                <strong className="text-gray-400">On by default.</strong> Google's own search index reflects the
                actual rendered page (including figures that only populate via client-side JS, like suburb
                median-price widgets), which grounds property research better than a Firecrawl/Tavily snippet.
                Gemini's search tool draws on a free-tier <strong className="text-gray-400">grounding quota</strong> that
                can return "quota / rate limit reached" under heavy use — if that becomes a problem, turn this off and
                Gemini will be grounded by the web-search tool above ({webSearchPrimary === 'firecrawl' ? 'Firecrawl' : 'Tavily'}) instead.
                No effect on DeepSeek / OpenRouter / NVIDIA — they always use the web-search tool above.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={autoFailover} onChange={e => setAutoFailover(e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span className="text-sm text-gray-200">Auto-failover on rate limit
              <span className="block text-xs text-gray-500 mt-0.5">
                When the active provider is rate-limited (429) or out of credits (402), automatically retry the
                request on the next provider that has a key (e.g. Gemini → OpenRouter). The fallback provider is
                grounded by the web-search tool above, and the result notes when a fallback was used. An
                OpenRouter key with no selected model falls over to a free model from its catalogue — click
                "Update models" so one is cached.
              </span>
            </span>
          </label>
        </Card>

        {/* Enable toggle */}
        <Card title="Status">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm text-gray-200">Enable live AI research
              <span className="block text-xs text-gray-500 mt-0.5">When disabled, "Research benchmarks" returns a 503. The static benchmark database remains available.</span>
            </span>
          </label>
        </Card>

        {/* Save / test */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleSave} disabled={saving || !dirty} className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium">{saving ? 'Saving…' : 'Save changes'}</button>
          <button onClick={handleTest} disabled={!settings.anyKey || testStatus?.type === 'running'} className="text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium">{testStatus?.type === 'running' ? 'Testing…' : 'Test connection (saved)'}</button>
          {saveMsg && <span className={`text-sm ${saveMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{saveMsg.text}</span>}
        </div>

        {testStatus && testStatus.type !== 'running' && (
          <div className={`p-3 rounded text-sm ${testStatus.type === 'ok' ? 'bg-green-900/40 border border-green-700 text-green-300' : 'bg-red-900/40 border border-red-700 text-red-300'}`}>
            <span className="font-semibold">{testStatus.type === 'ok' ? 'Test passed.' : 'Test failed.'}</span> {testStatus.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold text-white">AI Settings</h2>
      <p className="text-gray-400 text-sm mt-0.5">
        Configure the providers used by the live "Research benchmarks" and RV Research features. Store a key for
        Google Gemini, DeepSeek, OpenRouter and/or NVIDIA, then switch the active provider and model.
      </p>
    </div>
  );
}

function StatusBanner({ settings }: { settings: AISettings }) {
  const active = settings.providers.find(p => p.provider === settings.provider);
  if (active?.hasKey) {
    return (
      <p className="text-sm text-green-300 bg-green-900/40 border border-green-700 rounded px-4 py-2.5 mb-6">
        ✓ Active: <code className="font-mono text-green-200">{settings.provider}</code> / <code className="font-mono text-green-200">{settings.model}</code>
        {active.source === 'env' ? ' (env-var key)' : ''}.
      </p>
    );
  }
  if (settings.anyKey) {
    return (
      <p className="text-sm text-amber-300 bg-amber-900/40 border border-amber-700 rounded px-4 py-2.5 mb-6">
        ⚠ The active provider (<code className="font-mono">{settings.provider}</code>) has no key. Add one below or switch to a provider that does.
      </p>
    );
  }
  return (
    <p className="text-sm text-amber-300 bg-amber-900/40 border border-amber-700 rounded px-4 py-2.5 mb-6">
      ⚠ No AI provider is configured. Add a key below to enable live research. The static benchmark database remains available.
    </p>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ModelOption({ option, selected, onSelect }: { option: AIModelOption; selected: boolean; onSelect: () => void }) {
  const tierColors: Record<string, string> = {
    flash: 'bg-blue-900/40 border-blue-700 text-blue-300',
    pro: 'bg-purple-900/40 border-purple-700 text-purple-300',
    chat: 'bg-emerald-900/40 border-emerald-700 text-emerald-300',
    reasoner: 'bg-amber-900/40 border-amber-700 text-amber-300',
    free: 'bg-emerald-900/40 border-emerald-700 text-emerald-300',
    paid: 'bg-purple-900/40 border-purple-700 text-purple-300',
  };
  const priceLabel = option.inputPricePerMillion === 0 && option.outputPricePerMillion === 0
    ? 'free tier' : `$${option.inputPricePerMillion}/M in · $${option.outputPricePerMillion}/M out`;
  return (
    <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${selected ? 'bg-blue-900/40 border-blue-500 ring-2 ring-blue-500/50' : 'bg-gray-900/40 border-gray-700 hover:bg-gray-800'}`}>
      <input type="radio" name="model" checked={selected} onChange={onSelect} className="mt-1" />
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{option.label}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tierColors[option.tier] ?? tierColors.free} uppercase`}>{option.tier}</span>
          {option.supportsWebSearch
            ? <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-900/40 border-green-700 text-green-300 uppercase">web search</span>
            : <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-700/40 border-gray-600 text-gray-400 uppercase">no web search</span>}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">{option.recommendedFor}</div>
        <div className="text-[11px] text-gray-500 mt-1 font-mono">{option.contextWindow} context · {priceLabel} · <span className="text-gray-600">{option.id}</span></div>
      </div>
    </label>
  );
}
