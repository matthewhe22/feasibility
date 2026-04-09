import React from 'react';

interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render?: (value: any, row: any) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  title?: string;
  compact?: boolean;
  className?: string;
}

export function DataTable({ columns, data, title, compact, className = '' }: DataTableProps) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      {title && <h3 className="text-sm font-bold text-gray-700 mb-1 px-1">{title}</h3>}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-700 text-white">
            {columns.map(col => (
              <th
                key={col.key}
                className={`px-2 py-1.5 font-semibold ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={idx}
              className={`border-b border-gray-200 ${row._highlight ? 'bg-yellow-50 font-bold' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${row._total ? 'bg-gray-100 font-bold border-t-2 border-gray-400' : ''}`}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={`px-2 ${compact ? 'py-0.5' : 'py-1'} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                >
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
