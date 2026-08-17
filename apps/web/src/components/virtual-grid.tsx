import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface GridWindow {
  readonly first: number;
  readonly count: number;
  readonly columns: number;
  readonly rowHeight: number;
  readonly totalRows: number;
}

/**
 * ADR 0014. Renders only the rows near the viewport, so DOM size stops tracking
 * library size (F-04). The audit measured 19 274 nodes and a 279 685 px document
 * at 1200 books; a full-page screenshot exceeded a 30 s timeout.
 *
 * The grid is uniform — every cell is a 2:3 cover with a fixed caption — which is
 * what makes this arithmetic rather than measurement. That uniformity was chosen
 * back in Increment 5 for exactly this reason (audit §7.2).
 *
 * Screen-reader traversal is the risk the audit calls out: with only a window
 * rendered, assistive technology is told "1 of 24" when the shelf holds a thousand
 * books. `aria-setsize` and `aria-posinset` on every cell restore the real
 * position, and `virtual-grid.spec` asserts it rather than trusting axe, which
 * cannot know the list is windowed.
 */
export function VirtualGrid<T>({
  total,
  items,
  offset,
  minColumnWidth,
  rowHeight,
  overscanRows = 2,
  onWindowChange,
  children,
}: {
  readonly total: number;
  readonly items: readonly T[];
  readonly offset: number;
  readonly minColumnWidth: number;
  readonly rowHeight: number;
  readonly overscanRows?: number;
  readonly onWindowChange: (window: GridWindow) => void;
  readonly children: (item: T, index: number, aria: AriaPosition) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 1, scrollTop: 0, height: 800 });

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const measure = () => {
      const width = element.clientWidth || 1;
      // Mirrors `repeat(auto-fill, minmax(minColumnWidth, 1fr))`, so the rendered
      // window always matches what CSS actually lays out.
      const columns = Math.max(1, Math.floor((width + GAP) / (minColumnWidth + GAP)));
      setLayout({ columns, scrollTop: window.scrollY, height: window.innerHeight });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const onScroll = () =>
      setLayout((current) => ({
        ...current,
        scrollTop: window.scrollY,
        height: window.innerHeight,
      }));
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, [minColumnWidth]);

  const totalRows = Math.ceil(total / layout.columns);
  const gridTop = viewport.current?.offsetTop ?? 0;
  const firstVisibleRow = Math.max(
    0,
    Math.floor((layout.scrollTop - gridTop) / rowHeight) - overscanRows,
  );
  const visibleRows = Math.ceil(layout.height / rowHeight) + overscanRows * 2;
  const firstIndex = firstVisibleRow * layout.columns;
  const windowCount = Math.min(visibleRows * layout.columns, Math.max(total - firstIndex, 0));

  useEffect(() => {
    onWindowChange({
      first: firstIndex,
      count: windowCount,
      columns: layout.columns,
      rowHeight,
      totalRows,
    });
    // The callback identity changes every render at the call site; the window is
    // what determines whether a fetch is needed.
  }, [firstIndex, windowCount, layout.columns, rowHeight, totalRows]);

  // Spacers rather than absolute positioning: the scrollbar stays honest and the
  // grid keeps its normal flow, which matters for the sticky shell and for zoom.
  //
  // These measure from `offset` — where the fetched page actually starts — not
  // from the visible window. The two differ whenever the loaded page is wider than
  // the window, which is the normal case, and using the window here would float
  // the grid at the wrong scroll position.
  const leadingRows = Math.floor(offset / layout.columns);
  const trailingRows = Math.max(
    0,
    totalRows - leadingRows - Math.ceil(items.length / layout.columns),
  );

  return (
    <div ref={viewport} data-testid="virtual-grid">
      <div style={{ height: leadingRows * rowHeight }} aria-hidden="true" />
      <ul
        className="cover-grid"
        style={{ gridTemplateColumns: `repeat(${String(layout.columns)}, minmax(0, 1fr))` }}
      >
        {items.map((item, position) =>
          children(item, offset + position, {
            'aria-setsize': total,
            'aria-posinset': offset + position + 1,
          }),
        )}
      </ul>
      <div style={{ height: trailingRows * rowHeight }} aria-hidden="true" />
    </div>
  );
}

export interface AriaPosition {
  readonly 'aria-setsize': number;
  readonly 'aria-posinset': number;
}

/** Matches the 16px column gap in `.cover-grid`. */
const GAP = 16;
