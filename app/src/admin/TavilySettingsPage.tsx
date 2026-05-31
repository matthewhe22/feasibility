import { useEffect, useState } from 'react';
import {
  fetchTavilySettings,
  updateTavilySettings,
  testTavilyConnection,
  deleteTavilyKey,
  type TavilySettings,
  type TavilySearchDepth,
} from './api';

/**
 * Admin page for Tavily web search.
 *
 * Stores a Tavily API key server-side (never returned to the browser). When
 * configured, research requests running on a provider WITHOUT native web search
 * (DeepSeek / OpenRouter / NVIDIA) are grounded in live Tavily results. Gemini
 * keeps its own Google-Search grounding and does not use Tavily.
 */
export function TavilySettingsPage() {
  const [settings, setSettings] = useState<TavilySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [maxResults, setMaxResults] = useState(5);
  const [searchDepth, setSearchDepth] = useState<TavilySearchDepth>('basic');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testStatus, setTestStatus] = useState<{ type: 'ok' | 'err' | 'running'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTavilySettings()
      .then(s => {
        if (cancelled) return;
        setSettings(s);
        setEnabled(s.enabled);
        setMaxResults(s.maxResults);
        setSearchDepth(s.searchDepth);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await updateTavilySettings({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        enabled,
        maxResults,
        searchDepth,
      });
      setSaveMsg({ type: 'ok', text: 'Settings saved.' });
      setApiKey('');
      setShowKey(false);
      setSettings(s => s ? {
        ...s,
        hasKey: r.hasKey,
        hasStoredKey: r.hasKey,
        source: 'stored',
        keyPreview: r.keyPreview,
        enabled: r.enabled,
        maxResults: r.maxResults,
        searchDepth: r.searchDepth,
      } : s);
    } catch (e) {
      setSaveMsg({ type: 'err', text: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestStatus({ type: 'running', text: 'Running a live test search…' });
    try {
      const r = await testTavilyConnection({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        maxResults,
        searchDepth,
      });
      setTestStatus({ type: 'ok', text: r.message });
    } catch (e) {
      setTestStatus({ type: 'err', text: e instanceof Error ? e.message : 'Test failed.' });
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove the stored Tavily key? Non-Gemini providers will run without web search (or fall back to the TAVILY_API_KEY env var if set).')) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await deleteTavilyKey();
      const fresh = await fetchTavilySettings();
      setSettings(fresh);
      setEnabled(fresh.enabled);
      setMaxResults(fresh.maxResults);
      setSearchDepth(fresh.searchDepth);
      setSaveMsg({ type: 'ok', text: 'Stored key removed.' });
    } catch (e) {
      setSaveMsg({ type: 'err', text: e instanceof Error ? e.message : 'Remove failed.' });
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div>
        <Header />
        <p className="text-sm text-red-300 bg-red-900/40 border border-red-700 rounded px-4 py-2.5">
          Failed to load Tavily settings: {loadError}
        </p>
      </div>
    );
  }
  if (!settings) {
    return <div><Header /><p className="text-sm text-gray-400">Loading…</p></div>;
  }

  return (
    <div>
      <Header />
      <StatusBanner settings={settings} />

      <div className="space-y-6">
        {/* API key */}
        <Card title="Tavily API Key">
          <p className="text-xs text-gray-400 mb-3">
            Get a free key from{' '}
            <a className="text-blue-400 underline" target="_blank" rel="noopener" href="https://app.tavily.com/">app.tavily.com</a>
            {' '}(free tier ≈ 1,000 searches/month). The key is stored encrypted in the database and only ever read on the server.
          </p>

          {settings.hasStoredKey && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span className="text-gray-400">Stored key:</span>
              <code className="px-2 py-0.5 bg-gray-900 border border-gray-700 rounded text-blue-300 font-mono text-xs">{settings.keyPreview || '***'}</code>
              <button onClick={handleRemove} disabled={saving} className="ml-auto text-xs bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white px-2 py-1 rounded">Remove stored key</button>
            </div>
          )}
          {!settings.hasStoredKey && settings.hasEnvFallback && (
            <p className="text-[11px] text-blue-300 mb-2">Using the <code className="font-mono">TAVILY_API_KEY</code> env-var fallback.</p>
          )}

          <label className="block text-xs font-semibold text-gray-300 mb-1">
            {settings.hasStoredKey ? 'Replace key (leave blank to keep current)' : 'Set Tavily API key'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="tvly-..."
              autoComplete="off" spellCheck={false}
              className="flex-1 text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
            />
            <button type="button" onClick={() => setShowKey(s => !s)} className="text-xs bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 px-2 py-2 rounded">{showKey ? 'Hide' : 'Show'}</button>
          </div>
        </Card>

        {/* Search options */}
        <Card title="Search options">
          <div className="space-y-3">
            <Field label={`Results per search (${maxResults})`}>
              <input type="range" min={1} max={10} value={maxResults} onChange={e => setMaxResults(parseInt(e.target.value, 10))} className="w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Fewer results = tighter prompt + lower cost; more = broader grounding.</p>
            </Field>
            <Field label="Search depth">
              <select value={searchDepth} onChange={e => setSearchDepth(e.target.value as TavilySearchDepth)} className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500">
                <option value="basic">Basic — faster, 1 credit/search</option>
                <option value="advanced">Advanced — deeper, 2 credits/search</option>
              </select>
            </Field>
          </div>
        </Card>

        {/* Enable */}
        <Card title="Status">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span className="text-sm text-gray-200">Use Tavily to ground non-Gemini providers
              <span className="block text-xs text-gray-500 mt-0.5">
                When on, research running on DeepSeek / OpenRouter / NVIDIA injects live Tavily web results into the prompt
                (with cited URLs). Gemini keeps its own Google-Search grounding and never uses Tavily. Cached results are reused,
                so repeats cost no searches.
              </span>
            </span>
          </label>
        </Card>

        {/* Save / test */}
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium">{saving ? 'Saving…' : 'Save changes'}</button>
          <button onClick={handleTest} disabled={testStatus?.type === 'running' || (!settings.hasKey && !apiKey.trim())} className="text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium">{testStatus?.type === 'running' ? 'Testing…' : 'Test search'}</button>
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
      <h2 className="text-xl font-bold text-white">Tavily Search</h2>
      <p className="text-gray-400 text-sm mt-0.5">
        Give live web search to the providers that lack it. When a Tavily key is configured, research running on
        DeepSeek / OpenRouter / NVIDIA is grounded in current web results. Gemini uses its own Google-Search grounding.
      </p>
    </div>
  );
}

function StatusBanner({ settings }: { settings: TavilySettings }) {
  if (settings.source === 'stored') {
    return (
      <p className="text-sm text-green-300 bg-green-900/40 border border-green-700 rounded px-4 py-2.5 mb-6">
        ✓ Tavily is configured{settings.enabled ? ' — non-Gemini providers will be web-grounded.' : ' but disabled below.'}
      </p>
    );
  }
  if (settings.source === 'env') {
    return (
      <p className="text-sm text-blue-300 bg-blue-900/40 border border-blue-700 rounded px-4 py-2.5 mb-6">
        Using the fallback <code className="font-mono">TAVILY_API_KEY</code> environment variable. Save a key below to manage it from this UI.
      </p>
    );
  }
  return (
    <p className="text-sm text-amber-300 bg-amber-900/40 border border-amber-700 rounded px-4 py-2.5 mb-6">
      ⚠ Tavily is not configured. Non-Gemini providers run without live web search until you add a key below.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}
