import { useEffect, useState } from 'react';
import {
  fetchCotalitySettings,
  updateCotalitySettings,
  testCotalityConnection,
  deleteCotalityCredentials,
  type CotalitySettings,
  type CotalityRegion,
} from './api';

/**
 * Admin page for the Cotality (formerly CoreLogic) property-data API.
 *
 * Stores the OAuth2 client-credentials (Client ID + Secret) server-side, plus
 * the token URL / API base / region and an optional property-data path used to
 * ground the live AI benchmark research in real Cotality figures. The Secret is
 * never returned to the browser.
 */
export function CotalitySettingsPage() {
  const [settings, setSettings] = useState<CotalitySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [tokenUrl, setTokenUrl] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [region, setRegion] = useState<CotalityRegion>('au');
  const [propertyDataPath, setPropertyDataPath] = useState('');
  const [enabled, setEnabled] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testStatus, setTestStatus] = useState<{ type: 'ok' | 'err' | 'running'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCotalitySettings()
      .then(s => {
        if (cancelled) return;
        setSettings(s);
        setClientId(''); // never prefill; we don't echo the stored id, only its preview
        setTokenUrl(s.tokenUrl);
        setApiBaseUrl(s.apiBaseUrl);
        setRegion(s.region);
        setPropertyDataPath(s.propertyDataPath);
        setEnabled(s.enabled);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const patch = {
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        tokenUrl: tokenUrl.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        region,
        propertyDataPath: propertyDataPath.trim(),
        enabled,
      };
      const r = await updateCotalitySettings(patch);
      setSaveMsg({ type: 'ok', text: 'Settings saved.' });
      setClientSecret('');
      setShowSecret(false);
      setSettings(s => s ? {
        ...s,
        hasCredentials: r.hasCredentials,
        hasStoredCredentials: r.hasCredentials,
        source: 'stored',
        clientIdPreview: r.clientIdPreview,
        tokenUrl: r.tokenUrl,
        apiBaseUrl: r.apiBaseUrl,
        region: r.region,
        propertyDataPath: r.propertyDataPath,
        enabled: r.enabled,
      } : s);
      setClientId('');
    } catch (e) {
      setSaveMsg({ type: 'err', text: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestStatus({ type: 'running', text: 'Requesting an access token from Cotality…' });
    try {
      // Test the values currently in the form (so the admin can verify before
      // saving). Blank Client ID/Secret fall back to the stored values server-side.
      const r = await testCotalityConnection({
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        tokenUrl: tokenUrl.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        region,
      });
      setTestStatus({ type: 'ok', text: r.message });
    } catch (e) {
      setTestStatus({ type: 'err', text: e instanceof Error ? e.message : 'Test failed.' });
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove the stored Cotality credentials? Live AI research will fall back to web search only (or the COTALITY_CLIENT_ID / COTALITY_CLIENT_SECRET env vars if set).')) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await deleteCotalityCredentials();
      const fresh = await fetchCotalitySettings();
      setSettings(fresh);
      setTokenUrl(fresh.tokenUrl);
      setApiBaseUrl(fresh.apiBaseUrl);
      setRegion(fresh.region);
      setPropertyDataPath(fresh.propertyDataPath);
      setEnabled(fresh.enabled);
      setSaveMsg({ type: 'ok', text: 'Stored credentials removed.' });
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
          Failed to load Cotality settings: {loadError}
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
        {/* Credentials */}
        <Card title="API Credentials (OAuth2 client-credentials)">
          <p className="text-xs text-gray-400 mb-3">
            Get your consumer key &amp; secret from the{' '}
            <a className="text-blue-400 underline" target="_blank" rel="noopener" href="https://developer.corelogic.asia/">Cotality Developer Portal</a>.
            Credentials are stored encrypted in the database and only ever read on the server — they are never sent to the browser.
          </p>

          {settings.hasStoredCredentials && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span className="text-gray-400">Stored Client ID:</span>
              <code className="px-2 py-0.5 bg-gray-900 border border-gray-700 rounded text-blue-300 font-mono text-xs">
                {settings.clientIdPreview || '***'}
              </code>
              <button onClick={handleRemove} disabled={saving} className="ml-auto text-xs bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white px-2 py-1 rounded">
                Remove stored credentials
              </button>
            </div>
          )}

          <label className="block text-xs font-semibold text-gray-300 mb-1">
            {settings.hasStoredCredentials ? 'Replace Client ID (leave blank to keep current)' : 'Client ID (consumer key)'}
          </label>
          <input
            type="text"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="(paste your Cotality Client ID)"
            autoComplete="off"
            spellCheck={false}
            className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500 mb-3"
          />

          <label className="block text-xs font-semibold text-gray-300 mb-1">
            {settings.hasStoredCredentials ? 'Replace Client Secret (leave blank to keep current)' : 'Client Secret'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
              placeholder="(paste your Cotality Client Secret)"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
            />
            <button type="button" onClick={() => setShowSecret(s => !s)} className="text-xs bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 px-2 py-2 rounded">
              {showSecret ? 'Hide' : 'Show'}
            </button>
          </div>
        </Card>

        {/* Endpoints */}
        <Card title="Endpoints">
          <div className="space-y-3">
            <Field label="Region">
              <select value={region} onChange={e => setRegion(e.target.value as CotalityRegion)} className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500">
                <option value="au">Australia</option>
                <option value="nz">New Zealand</option>
              </select>
            </Field>
            <Field label="OAuth2 token URL">
              <input type="text" value={tokenUrl} onChange={e => setTokenUrl(e.target.value)} spellCheck={false}
                className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500" />
            </Field>
            <Field label="API base URL">
              <input type="text" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} spellCheck={false}
                className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500" />
            </Field>
            <p className="text-[10px] text-gray-500">
              Defaults: token <code className="font-mono">{settings.defaults.tokenUrl}</code> (PingFederate auth host),
              API base <code className="font-mono">{settings.defaults.apiBaseUrl}</code> (production).
              For a <strong className="text-gray-400">Sandbox</strong> client, set the API base to{' '}
              <code className="font-mono">https://api-sbox.corelogic.asia</code> (the token URL is the same for sandbox and prod).
            </p>
          </div>
        </Card>

        {/* Property data path (optional grounding) */}
        <Card title="Property data path (optional)">
          <p className="text-xs text-gray-400 mb-3">
            When set, every GRV / cost research request fetches this Cotality endpoint and feeds the result to the AI model as the
            <strong className="text-gray-200"> primary, authoritative source</strong> for the benchmark — so GRV and cost estimates are grounded in your real Cotality data rather than web search alone.
            Supports <code className="font-mono text-gray-300">{'{suburb}'}</code> <code className="font-mono text-gray-300">{'{state}'}</code> <code className="font-mono text-gray-300">{'{postcode}'}</code> placeholders.
            Leave blank to use the credentials for connection verification only.
          </p>
          <input
            type="text"
            value={propertyDataPath}
            onChange={e => setPropertyDataPath(e.target.value)}
            placeholder="/search/au/property/address?q={suburb}%20{state}"
            spellCheck={false}
            className="w-full text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
          />
          <p className="text-[10px] text-gray-500 mt-2">
            The exact path depends on the Cotality products your client is entitled to — copy it from the{' '}
            <a className="text-blue-400 underline" target="_blank" rel="noopener" href="https://developer.corelogic.asia/">API reference</a>{' '}
            for your client. A "Property Search" client typically exposes address search / suggest and property-detail endpoints
            (e.g. <code className="font-mono">/search/au/property/address</code>); sales-statistics / AVM endpoints require those products.
            The path is appended to the API base URL and called with the bearer token. Failures fall back to web research automatically.
          </p>
        </Card>

        {/* Enable */}
        <Card title="Status">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm text-gray-200">
              Use Cotality data to ground AI benchmark research
              <span className="block text-xs text-gray-500 mt-0.5">
                When disabled, research runs on web search only. The static benchmark database is unaffected.
              </span>
            </span>
          </label>
        </Card>

        {/* Save / test */}
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={handleTest} disabled={testStatus?.type === 'running'} className="text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium">
            {testStatus?.type === 'running' ? 'Testing…' : 'Test connection'}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{saveMsg.text}</span>
          )}
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
      <h2 className="text-xl font-bold text-white">Cotality Data</h2>
      <p className="text-gray-400 text-sm mt-0.5">
        Connect your Cotality (formerly CoreLogic) property-data subscription. When configured, the live
        "Research benchmarks" buttons ground their GRV and cost estimates in real Cotality figures via the AI model.
      </p>
    </div>
  );
}

function StatusBanner({ settings }: { settings: CotalitySettings }) {
  if (settings.source === 'stored') {
    return (
      <p className="text-sm text-green-300 bg-green-900/40 border border-green-700 rounded px-4 py-2.5 mb-6">
        ✓ Cotality is configured via admin-stored credentials{settings.propertyDataPath ? ' and a property-data path — AI research will be grounded in Cotality data.' : '. Set a property-data path below to ground AI research in Cotality figures.'}
      </p>
    );
  }
  if (settings.source === 'env') {
    return (
      <p className="text-sm text-blue-300 bg-blue-900/40 border border-blue-700 rounded px-4 py-2.5 mb-6">
        Using fallback <code className="font-mono">COTALITY_CLIENT_ID</code> / <code className="font-mono">COTALITY_CLIENT_SECRET</code> environment variables. Save credentials below to manage them from this UI.
      </p>
    );
  }
  return (
    <p className="text-sm text-amber-300 bg-amber-900/40 border border-amber-700 rounded px-4 py-2.5 mb-6">
      ⚠ Cotality is not configured. AI benchmark research runs on web search only until you add credentials below.
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
