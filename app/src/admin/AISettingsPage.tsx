import { useEffect, useState } from 'react';
import {
  fetchAISettings,
  updateAISettings,
  deleteStoredAIKey,
  type AISettings,
  type AIModelId,
  type AIModelOption,
} from './api';

export function AISettingsPage() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<AIModelId>('gemini-2-0-flash');
  const [enabled, setEnabled] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [testStatus, setTestStatus] = useState<{ type: 'ok' | 'err' | 'running'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAISettings()
      .then(s => {
        if (cancelled) return;
        setSettings(s);
        setModel(s.model);
        setEnabled(s.enabled);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const patch: { apiKey?: string; model?: AIModelId; enabled?: boolean } = { model, enabled };
      if (keyInput.trim()) patch.apiKey = keyInput.trim();
      const r = await updateAISettings(patch);
      setSaveMsg({ type: 'ok', text: 'Settings saved.' });
      setKeyInput('');
      setShowKey(false);
      setSettings(s => s ? { ...s, hasKey: r.hasKey, keyPreview: r.keyPreview, model: r.model, enabled: r.enabled, source: 'stored', hasStoredKey: r.hasKey } : s);
    } catch (e) {
      setSaveMsg({ type: 'err', text: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    if (!confirm('Remove the stored Google Gemini API key? Live AI research will fall back to the GEMINI_API_KEY env var (if set) — otherwise it will be disabled.')) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await deleteStoredAIKey();
      const fresh = await fetchAISettings();
      setSettings(fresh);
      setModel(fresh.model);
      setEnabled(fresh.enabled);
      setSaveMsg({ type: 'ok', text: 'Stored key removed.' });
    } catch (e) {
      setSaveMsg({ type: 'err', text: e instanceof Error ? e.message : 'Remove failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestStatus({ type: 'running', text: 'Running a small benchmark research request…' });
    try {
      const r = await fetch('/api/benchmarks/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'construction',
          buildingType: 'High-rise apartments (15+ storeys)',
          storeys: 20,
          state: 'NSW',
          finishQuality: 'standard',
          siteComplexity: 'moderate',
          gfa: 10000,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      setTestStatus({
        type: 'ok',
        text: `Success — got $${data.rateLow?.toLocaleString?.()}–$${data.rateHigh?.toLocaleString?.()} /m² from ${data.model} (${data.sources?.length ?? 0} sources). Live AI research is working.`,
      });
    } catch (e) {
      setTestStatus({
        type: 'err',
        text: e instanceof Error ? e.message : 'Test failed.',
      });
    }
  };

  if (loadError) {
    return (
      <div>
        <Header />
        <p className="text-sm text-red-300 bg-red-900/40 border border-red-700 rounded px-4 py-2.5">
          Failed to load AI settings: {loadError}
        </p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div>
        <Header />
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  const dirty =
    keyInput.trim() !== '' ||
    model !== settings.model ||
    enabled !== settings.enabled;

  return (
    <div>
      <Header />

      {/* Status banner */}
      <StatusBanner settings={settings} />

      <div className="space-y-6">
        {/* API Key */}
        <Card title="Google Gemini API Key (Free)">
          <p className="text-xs text-gray-400 mb-3">
            Get a free key from <a className="text-blue-400 underline" target="_blank" rel="noopener" href="https://aistudio.google.com/apikey">aistudio.google.com/apikey</a>.
            Free tier: 60 requests/minute, 1500 requests/day. Keys are stored encrypted in the database and only ever read on the server — they are never sent to the browser.
          </p>

          {settings.hasStoredKey && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span className="text-gray-400">Current stored key:</span>
              <code className="px-2 py-0.5 bg-gray-900 border border-gray-700 rounded text-blue-300 font-mono text-xs">
                {settings.keyPreview || 'sk-ant-***'}
              </code>
              <button
                onClick={handleRemoveKey}
                disabled={saving}
                className="ml-auto text-xs bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white px-2 py-1 rounded"
              >
                Remove stored key
              </button>
            </div>
          )}

          <label className="block text-xs font-semibold text-gray-300 mb-1">
            {settings.hasStoredKey ? 'Replace key (leave blank to keep current)' : 'Set API key'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="(paste your Gemini API key)"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowKey(s => !s)}
              className="text-xs bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 px-2 py-2 rounded"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </Card>

        {/* Model selector */}
        <Card title="Default Model">
          <p className="text-xs text-gray-400 mb-3">
            Used for every "Research live benchmarks" request. Higher-tier models give more accurate research at higher cost per request.
          </p>
          <div className="space-y-2">
            {settings.allowedModels.map(opt => (
              <ModelOption
                key={opt.id}
                option={opt}
                selected={model === opt.id}
                onSelect={() => setModel(opt.id)}
              />
            ))}
          </div>
        </Card>

        {/* Enable toggle */}
        <Card title="Status">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-200">
              Enable live AI research
              <span className="block text-xs text-gray-500 mt-0.5">
                When disabled, the "Research live benchmarks" button on cost-reference cards returns a 503. The static benchmark database remains available.
              </span>
            </span>
          </label>
        </Card>

        {/* Save / messages */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            onClick={handleTest}
            disabled={!settings.hasKey || (testStatus?.type === 'running')}
            className="text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-4 py-2 rounded font-medium"
          >
            {testStatus?.type === 'running' ? 'Testing…' : 'Test connection'}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
              {saveMsg.text}
            </span>
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
      <h2 className="text-xl font-bold text-white">AI Settings</h2>
      <p className="text-gray-400 text-sm mt-0.5">
        Configure the Google Gemini API key (free tier available) and model used by the live "Research benchmarks" button on cost-reference cards.
      </p>
    </div>
  );
}

function StatusBanner({ settings }: { settings: AISettings }) {
  if (settings.source === 'stored') {
    return (
      <p className="text-sm text-green-300 bg-green-900/40 border border-green-700 rounded px-4 py-2.5 mb-6">
        ✓ Live AI research is configured via the admin-stored key.
        Active model: <code className="font-mono text-green-200">{settings.model}</code>.
      </p>
    );
  }
  if (settings.source === 'env') {
    return (
      <p className="text-sm text-blue-300 bg-blue-900/40 border border-blue-700 rounded px-4 py-2.5 mb-6">
        Using fallback <code className="font-mono">GEMINI_API_KEY</code> environment variable.
        Set a stored key below to manage it from this UI (the env var will then be ignored).
      </p>
    );
  }
  return (
    <p className="text-sm text-amber-300 bg-amber-900/40 border border-amber-700 rounded px-4 py-2.5 mb-6">
      ⚠ Live AI research is not configured. Set an API key below to enable the
      "Research live benchmarks" button on cost-reference cards. The static benchmark
      database remains available.
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

function ModelOption({
  option,
  selected,
  onSelect,
}: {
  option: AIModelOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const tierColors: Record<typeof option.tier, string> = {
    flash: 'bg-blue-900/40   border-blue-700   text-blue-300',
    pro:   'bg-purple-900/40 border-purple-700 text-purple-300',
  };
  return (
    <label
      className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
        selected
          ? 'bg-blue-900/40 border-blue-500 ring-2 ring-blue-500/50'
          : 'bg-gray-900/40 border-gray-700 hover:bg-gray-800'
      }`}
    >
      <input
        type="radio"
        name="model"
        checked={selected}
        onChange={onSelect}
        className="mt-1"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{option.label}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tierColors[option.tier]} uppercase`}>
            {option.tier}
          </span>
        </div>
        <div className="text-xs text-gray-400 mt-0.5">{option.recommendedFor}</div>
        <div className="text-[11px] text-gray-500 mt-1 font-mono">
          {option.contextWindow} context · ${option.inputPricePerMillion}/M in · ${option.outputPricePerMillion}/M out · <span className="text-gray-600">{option.id}</span>
        </div>
      </div>
    </label>
  );
}
