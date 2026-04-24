import { useState } from 'react';
import { useStore } from '../store/useStore';
import { saveBrandingSettings } from '../db/projectDb';

export function BrandingPage() {
  const { admin, setAdmin } = useStore();
  const [saving, setSaving] = useState(false);

  const applyBranding = (patch: Partial<typeof admin>) => {
    const next = { ...admin, ...patch };
    setAdmin(patch);
    setSaving(true);
    saveBrandingSettings({
      appName: next.appName,
      logoDataUrl: next.logoDataUrl,
      faviconDataUrl: next.faviconDataUrl,
      appBgColor: next.appBgColor,
    }).finally(() => setSaving(false));
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'logoDataUrl' | 'faviconDataUrl',
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      applyBranding({ [field]: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const DEFAULT_BG = '#f3f4f6';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Branding &amp; Appearance</h2>
          <p className="text-gray-400 text-sm mt-0.5">Customise the app title, logo, favicon and background colour.</p>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-blue-400 text-sm">Saving…</span>}
          <button
            onClick={() => {
              if (!confirm('Reset all branding to defaults?')) return;
              applyBranding({ appName: undefined, logoDataUrl: undefined, faviconDataUrl: undefined, appBgColor: undefined });
            }}
            className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded font-medium transition-colors"
          >
            Reset to Defaults
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <p className="text-sm text-blue-300 bg-blue-900/40 border border-blue-700 rounded px-4 py-2.5">
          Branding is saved globally to the database — changes are visible from any device immediately.
        </p>

        {/* App name */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
          <label className="block text-sm font-semibold text-gray-200 mb-1.5">Application Title</label>
          <input
            type="text"
            value={admin.appName ?? ''}
            placeholder="Project Development Feasibility Model"
            onChange={e => applyBranding({ appName: e.target.value || undefined })}
            className="w-full max-w-md text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1.5">Shown in the header and browser tab. Leave blank for the default title.</p>
        </div>

        {/* Page background colour */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
          <label className="block text-sm font-semibold text-gray-200 mb-1.5">Page Background Colour</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={admin.appBgColor ?? DEFAULT_BG}
              onChange={e => applyBranding({ appBgColor: e.target.value })}
              className="h-9 w-16 rounded border border-gray-600 cursor-pointer bg-gray-700"
            />
            <input
              type="text"
              value={admin.appBgColor ?? DEFAULT_BG}
              placeholder={DEFAULT_BG}
              onChange={e => applyBranding({ appBgColor: e.target.value || undefined })}
              className="w-32 text-sm bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => applyBranding({ appBgColor: undefined })}
              className="text-sm text-gray-400 hover:text-white underline"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Logo */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
          <label className="block text-sm font-semibold text-gray-200 mb-1.5">Header Logo</label>
          <div className="flex items-start gap-5">
            {admin.logoDataUrl ? (
              <div className="flex flex-col items-center gap-1.5">
                <img src={admin.logoDataUrl} alt="Logo preview" className="h-16 w-auto object-contain border border-gray-600 rounded p-1 bg-gray-900" />
                <button
                  onClick={() => applyBranding({ logoDataUrl: undefined })}
                  className="text-xs text-red-400 hover:text-red-300 underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="h-16 w-28 border border-dashed border-gray-600 rounded flex items-center justify-center text-xs text-gray-500 bg-gray-900">
                No logo
              </div>
            )}
            <div>
              <label className="cursor-pointer inline-block text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-medium transition-colors">
                Upload Logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => handleFileUpload(e, 'logoDataUrl')}
                />
              </label>
              <p className="text-xs text-gray-500 mt-1.5">PNG, SVG or JPG. Displayed at 40px height in the app header.</p>
            </div>
          </div>
        </div>

        {/* Favicon */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
          <label className="block text-sm font-semibold text-gray-200 mb-1.5">Browser Tab Favicon</label>
          <div className="flex items-start gap-5">
            {admin.faviconDataUrl ? (
              <div className="flex flex-col items-center gap-1.5">
                <img src={admin.faviconDataUrl} alt="Favicon preview" className="h-10 w-10 object-contain border border-gray-600 rounded p-1 bg-gray-900" />
                <button
                  onClick={() => applyBranding({ faviconDataUrl: undefined })}
                  className="text-xs text-red-400 hover:text-red-300 underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="h-10 w-10 border border-dashed border-gray-600 rounded flex items-center justify-center text-xs text-gray-500 bg-gray-900">
                —
              </div>
            )}
            <div>
              <label className="cursor-pointer inline-block text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-medium transition-colors">
                Upload Favicon
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => handleFileUpload(e, 'faviconDataUrl')}
                />
              </label>
              <p className="text-xs text-gray-500 mt-1.5">ICO, PNG or SVG. Applied immediately to the browser tab.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
