import React from 'react';

interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: Array<Record<string, unknown>>;
  title?: string;
  /** Hidden screen-reader description (table caption). Falls back to title. */
  caption?: string;
  compact?: boolean;
  className?: string;
  /** Sticky header sticks to the top of the scroll container. Default true. */
  stickyHeader?: boolean;
  /** Optional stable row key derived from the row — defaults to row.code / row.id / row index. */
  rowKey?: (row: Record<string, unknown>, idx: number) => string | number;
}

export function DataTable({
  columns, data, title, caption, compact, className = '', stickyHeader = true, rowKey,
}: DataTableProps) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      {title && <h3 className="text-sm font-bold text-gray-700 mb-1 px-1">{title}</h3>}
      <table className="w-full border-collapse text-xs">
        {(caption || title) && (
          <caption className="sr-only">{caption || title}</caption>
        )}
        <thead className={stickyHeader ? 'sticky top-0 z-10' : undefined}>
          <tr className="bg-gray-700 text-white">
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                className={`px-2 py-1.5 font-semibold ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const key = rowKey
              ? rowKey(row, idx)
              : (typeof row.code === 'string' ? row.code
                : typeof row.id === 'string' ? row.id
                : typeof row.id === 'number' ? row.id
                : idx);
            return (
              <tr
                key={key}
                className={`border-b border-gray-200 ${row._highlight ? 'bg-yellow-50 font-bold' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${row._total ? 'bg-gray-100 font-bold border-t-2 border-gray-400' : ''}`}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-2 ${compact ? 'py-0.5' : 'py-1'} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                  >
                    {col.render ? col.render(row[col.key], row) : (row[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
