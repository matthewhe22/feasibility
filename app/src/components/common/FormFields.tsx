// FormFields.tsx
import { useId, type ReactNode } from 'react';

interface CurrencyInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
  /** Optional explicit id (otherwise a stable React id is generated). */
  id?: string;
}

export function CurrencyInput({ label, value, onChange, disabled, className = '', id }: CurrencyInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={inputId} className="text-xs text-gray-600 w-56 shrink-0">{label}</label>
      <div className="relative">
        <span aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={value.toLocaleString('en-AU')}
          onChange={(e) => {
            const num = parseFloat(e.target.value.replace(/[^0-9.-]/g, ''));
            if (!isNaN(num)) onChange(num);
          }}
          disabled={disabled}
          aria-label={label}
          className="w-40 pl-5 pr-2 py-1 text-xs text-right border border-gray-300 rounded bg-yellow-50 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 disabled:bg-gray-100"
        />
      </div>
    </div>
  );
}

interface PercentInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function PercentInput({ label, value, onChange, disabled, className = '', id }: PercentInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={inputId} className="text-xs text-gray-600 w-56 shrink-0">{label}</label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={(value * 100).toFixed(4)}
          onChange={(e) => {
            const num = parseFloat(e.target.value);
            if (!isNaN(num)) onChange(num / 100);
          }}
          disabled={disabled}
          aria-label={label}
          className="w-28 pr-6 pl-2 py-1 text-xs text-right border border-gray-300 rounded bg-yellow-50 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 disabled:bg-gray-100"
        />
        <span aria-hidden="true" className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
      </div>
    </div>
  );
}

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
  suffix?: string;
  id?: string;
}

export function NumberInput({ label, value, onChange, disabled, className = '', suffix, id }: NumberInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={inputId} className="text-xs text-gray-600 w-56 shrink-0">{label}</label>
      <div className="relative">
        <input
          id={inputId}
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          disabled={disabled}
          aria-label={label}
          className="w-28 px-2 py-1 text-xs text-right border border-gray-300 rounded bg-yellow-50 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 disabled:bg-gray-100"
        />
        {suffix && <span aria-hidden="true" className="ml-1 text-xs text-gray-400">{suffix}</span>}
      </div>
    </div>
  );
}

interface TextInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function TextInput({ label, value, onChange, disabled, className = '', id }: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={inputId} className="text-xs text-gray-600 w-56 shrink-0">{label}</label>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className="w-48 px-2 py-1 text-xs border border-gray-300 rounded bg-yellow-50 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 disabled:bg-gray-100"
      />
    </div>
  );
}

interface SelectInputProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  className?: string;
  id?: string;
}

export function SelectInput({ label, value, options, onChange, className = '', id }: SelectInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={inputId} className="text-xs text-gray-600 w-56 shrink-0">{label}</label>
      <select
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-48 px-2 py-1 text-xs border border-gray-300 rounded bg-yellow-50 focus:ring-1 focus:ring-blue-400"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

interface SectionHeaderProps {
  number: string;
  title: string;
  className?: string;
  children?: ReactNode;
}

export function SectionHeader({ number, title, className = '', children }: SectionHeaderProps) {
  return (
    <div className={`flex items-center gap-2 bg-gray-700 text-white px-3 py-1.5 rounded-t ${className}`}>
      <span className="font-bold text-sm">{number}</span>
      <span className="font-semibold text-sm flex-1">{title}</span>
      {children}
    </div>
  );
}
