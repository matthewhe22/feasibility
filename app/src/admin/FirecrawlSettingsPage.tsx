import { useEffect, useState } from 'react';
import {
  fetchFirecrawlSettings,
  updateFirecrawlSettings,
  testFirecrawlConnection,
  deleteFirecrawlKey,
  type FirecrawlSettings,
} from './api';

/**
 * Admin page for Firecrawl web search.
 *
 * Stores a Firecrawl API key server-side (never returned to the browser). When
 * configured, research requests running on a provider WITHOUT native web search
 * (DeepSeek / OpenRouter / NVIDIA) are grounded in live Firecrawl results.
 * Gemini keeps its own Google-Search grounding.
 *
 * Firecrawl is the default PRIMARY search tool; which tool leads, and whether
 * the other is used as a fallback, is set in Admin → AI Settings.
 */
export function FirecrawlSettingsPage() {
  const [settings, setSettings] = useState<FirecrawlSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [maxResults, setMaxResults] = useState(5);
  const [scrapeContent, setScrapeContent] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.firecrawl.dev');
  const [searchPath, setSearchPath] = useState('/v2/search');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testStatus, setTestStatus] = useState<{ type: 'ok' | 'err' | 'running'; text: string } | null>(null);

  const applyToForm = (s: FirecrawlSettings) => {
    setEnabled(s.enabled);
    setMaxResults(s.maxResults);
    setScrapeContent(s.scrapeContent);
    setApiBaseUrl(s.apiBaseUrl);
    setSearchPath(s.searchPath);
  };

  useEffect(() => {
    let cancelled = false;
    fetchFirecrawlSettings()
      .then(s => {
        if (cancelled) return;
        setSettings(s);
        applyToForm(s);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await updateFirecrawlSettings({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        enabled,
        maxResults,
        scrapeContent,
        apiBaseUrl,
        searchPath,
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
        apiBaseUrl: r.apiBaseUrl,
        searchPath: r.searchPath,
        scrapeContent: r.scrapeContent,
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
      const r = await testFirecrawlConnection({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        maxResults,
        scrapeContent,
        apiBaseUrl,
        searchPath,
      });
      // The server retries the sibling API version on a 404; if that is what
      // answered, offer to adopt it so the fallback isn't paid for every call.
      if (r.pathUsed && r.pathUsed !== searchPath) setSearchPath(r.pathUsed);
      setTestStatus({ type: 'ok', text: r.message });
    } catch (e) {
      setTestStatus({ type: 'err', text: e instanceof Error ? e.message : 'Test failed.' });
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove the stored Firecrawl key? Web-search grounding will fall back to Tavily (or the FIRECRAWL_API_KEY env var if set).')) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await deleteFirecrawlKey();
      const fresh = await fetchFirecrawlSettings();
      setSettings(fresh);
      applyToForm(fresh);
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
          Failed to load Firecrawl settings: {loadError}
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
        <Card title="Firecrawl API Key">
          <p className="text-xs text-gray-400 mb-3">
            Get a key from{' '}
            <a className="text-blue-400 underline" target="_blank" rel="noopener" href="https://www.firecrawl.dev/app/api-keys">firecrawl.dev</a>
            {' '}(free tier includes a monthly credit allowance). The key is stored in the database and only ever read on the server.
          </p>

          {settings.hasStoredKey && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span className="text-gray-400">Stored key:</span>
              <code className="px-2 py-0.5 bg-gray-900 border border-gray-700 rounded text-blue-300 font-mono text-xs">{settings.keyPreview || '***'}</code>
              <button onClick={handleRemove} disabled={saving} className="ml-auto text-xs bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white px-2 py-1 rounded">Remove stored key</button>
            </div>
          )}
          {!settings.hasStoredKey && settings.hasEnvFallback && (
            <p className="text-[11px] text-blue-300 mb-2">Using the <code className="font-mono">FIRECRAWL_API_KEY</code> env-var fallback.</p>
          )}

          <label className="block text-xs font-semibold text-gray-300 mb-1">
            {settings.hasStoredKey ? 'Replace key (leave blank to keep current)' : 'Set Firecrawl API key'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="fc-..."
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
              <p className="text-[10px] text-gray-500 mt-1">Fewer results = tighter prompt + fewer credits; more = broader grounding.</p>
            </Field>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={scrapeContent} onChange={e => setScrapeContent(e.target.checked)} className="w-4 h-4 mt-0.5" />
              <span className="text-sm text-gray-200">Scrape full page content
                <span className="block text-xs text-gray-500 mt-0.5">
                  Firecrawl's advantage over snippet-only search: it fetches each result and returns the page as markdown, so
                  figures buried in a report body reach the model. Costs noticeably more credits per search — leave off if you
                  are watching the allowance.
                </span>
              </span>
            </label>
          </div>
        </Card>

        {/* Endpoint */}
        <Card title="API endpoint">
          <p className="text-xs text-gray-400 mb-3">
            Defaults suit Firecrawl's hosted API. Change the base URL to point at a self-hosted instance, or the search path if
            your account is on a different API version. "Test search" retries the sibling version automatically on a 404 and
            reports which one answered.
          </p>
          <div className="space-y-3">
            <Field label="API base URL">
              <input
                type="text" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)}
                placeholder="https://api.firecrawl.dev" spellCheck={false}
                className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="Search path">
              <select value={searchPath} onChange={e => setSearchPath(e.target.value)} className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500">
                <option value="/v2/search">/v2/search — current API</option>
                <option value="/v1/search">/v1/search — legacy API</option>
              </select>
            </Field>
          </div>
        </Card>

        {/* Enable */}
        <Card title="Status">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span className="text-sm text-gray-200">Use Firecrawl to ground non-Gemini providers
              <span className="block text-xs text-gray-500 mt-0.5">
                When on, research running on DeepSeek / OpenRouter / NVIDIA injects live Firecrawl results into the prompt
                (with cited URLs). Gemini keeps its own Google-Search grounding. Cached results are reused, so repeats cost
                no credits. Set which tool runs first in <strong className="text-gray-400">AI Settings → Web search grounding</strong>.
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
      <h2 className="text-xl font-bold text-white">Firecrawl Search</h2>
      <p className="text-gray-400 text-sm mt-0.5">
        The default primary web-search tool for providers without native search. Firecrawl can return full scraped page
        content, not just snippets, which grounds benchmark figures better than search summaries alone.
      </p>
    </div>
  );
}

function StatusBanner({ settings }: { settings: FirecrawlSettings }) {
  if (settings.source === 'stored') {
    return (
      <p className="text-sm text-green-300 bg-green-900/40 border border-green-700 rounded px-4 py-2.5 mb-6">
        ✓ Firecrawl is configured{settings.enabled ? ' — non-Gemini providers will be web-grounded.' : ' but disabled below.'}
      </p>
    );
  }
  if (settings.source === 'env') {
    return (
      <p className="text-sm text-blue-300 bg-blue-900/40 border border-blue-700 rounded px-4 py-2.5 mb-6">
        Using the fallback <code className="font-mono">FIRECRAWL_API_KEY</code> environment variable. Save a key below to manage it from this UI.
      </p>
    );
  }
  return (
    <p className="text-sm text-amber-300 bg-amber-900/40 border border-amber-700 rounded px-4 py-2.5 mb-6">
      ⚠ Firecrawl is not configured. Web-search grounding falls back to Tavily until you add a key below.
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
