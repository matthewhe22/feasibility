import { useEffect, useMemo, useState } from 'react';
import {
  fetchAISettings,
  updateAISettings,
  deleteStoredAIKey,
  refreshOpenRouterModels,
  type AISettings,
  type AIProvider,
  type AIModelOption,
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
    description: 'One key, hundreds of models incl. many free ones. Use "Update models" to load the current free list. Most free models have no live web search.',
    keyPlaceholder: 'sk-or-v1-...',
  },
};

const PROVIDER_ORDER: AIProvider[] = ['gemini', 'deepseek', 'openrouter'];

export function AISettingsPage() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [model, setModel] = useState<string>('gemini-2-0-flash');
  const [enabled, setEnabled] = useState(true);
  // Per-provider draft key replacements (blank = keep stored).
  const [keyInputs, setKeyInputs] = useState<Record<AIProvider, string>>({ gemini: '', deepseek: '', openrouter: '' });
  const [showKey, setShowKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testStatus, setTestStatus] = useState<{ type: 'ok' | 'err' | 'running'; text: string } | null>(null);
  const [orRefreshing, setOrRefreshing] = useState(false);
  const [orMsg, setOrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAISettings()
      .then(s => {
        if (cancelled) return;
        setSettings(s);
        setProvider(s.provider);
        setModel(s.model);
        setEnabled(s.enabled);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, []);

  const modelOptions: AIModelOption[] = useMemo(() => {
    if (!settings) return [];
    if (provider === 'openrouter') {
      return settings.openrouterModels.map(m => ({
        id: m.id,
        label: m.label,
        provider: 'openrouter' as const,
        tier: 'free' as const,
        contextWindow: m.contextLength ? `${Math.round(m.contextLength / 1000)}K` : '—',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        supportsWebSearch: false,
        recommendedFor: 'OpenRouter free model.',
      }));
    }
    return settings.allowedModels.filter(m => m.provider === provider);
  }, [settings, provider]);

  // When switching provider, snap the model to a valid one for that provider.
  function selectProvider(p: AIProvider) {
    setProvider(p);
    if (!settings) return;
    const opts = p === 'openrouter'
      ? settings.openrouterModels.map(m => m.id)
      : settings.allowedModels.filter(m => m.provider === p).map(m => m.id);
    if (!opts.includes(model)) setModel(opts[0] ?? '');
  }

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const keys: Partial<Record<AIProvider, string>> = {};
      for (const p of PROVIDER_ORDER) if (keyInputs[p].trim()) keys[p] = keyInputs[p].trim();
      const patch = { provider, model, enabled, ...(Object.keys(keys).length ? { keys } : {}) };
      await updateAISettings(patch);
      // Refetch to get fresh previews / providers status.
      const fresh = await fetchAISettings();
      setSettings(fresh);
      setKeyInputs({ gemini: '', deepseek: '', openrouter: '' });
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

  const handleRefreshOpenRouter = async () => {
    setOrRefreshing(true);
    setOrMsg(null);
    try {
      const r = await refreshOpenRouterModels();
      setSettings(s => s ? { ...s, openrouterModels: r.models, openrouterModelsUpdatedAt: r.updatedAt } : s);
      // If on OpenRouter with no valid selection, pick the first.
      if (provider === 'openrouter' && !r.models.some(m => m.id === model)) {
        setModel(r.models[0]?.id ?? '');
      }
      setOrMsg(`Loaded ${r.count} free models.`);
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
        body: JSON.stringify({ mode: 'construction', buildingType: 'High-rise apartments (15+ storeys)', storeys: 20, state: 'NSW', finishQuality: 'standard', siteComplexity: 'moderate', gfa: 10000 }),
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
  const dirty =
    provider !== settings.provider || model !== settings.model || enabled !== settings.enabled ||
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
          </div>
        </Card>

        {/* Model selector */}
        <Card title="Model">
          {provider === 'openrouter' && (
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <button onClick={handleRefreshOpenRouter} disabled={orRefreshing} className="text-xs bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white px-3 py-1.5 rounded font-medium">
                {orRefreshing ? 'Updating…' : 'Update models (free)'}
              </button>
              {settings.openrouterModelsUpdatedAt && (
                <span className="text-[10px] text-gray-500">Last updated {new Date(settings.openrouterModelsUpdatedAt).toLocaleString()}</span>
              )}
              {orMsg && <span className="text-[10px] text-gray-300">{orMsg}</span>}
            </div>
          )}

          {modelOptions.length === 0 ? (
            <p className="text-xs text-gray-400">
              {provider === 'openrouter'
                ? 'No models loaded yet — click "Update models (free)" to fetch OpenRouter\'s current free model list.'
                : 'No models available.'}
            </p>
          ) : provider === 'openrouter' ? (
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500">
              {modelOptions.map(m => <option key={m.id} value={m.id}>{m.label} ({m.contextWindow})</option>)}
            </select>
          ) : (
            <div className="space-y-2">
              {modelOptions.map(opt => <ModelOption key={opt.id} option={opt} selected={model === opt.id} onSelect={() => setModel(opt.id)} />)}
            </div>
          )}
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
        Google Gemini, DeepSeek and/or OpenRouter, then switch the active provider and model.
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
