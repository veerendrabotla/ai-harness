"use client";
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateHeight?: number;
  overscan?: number;
  className?: string;
  ariaLabel?: string;
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateHeight = 80,
  overscan = 5,
  className,
  ariaLabel,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateHeight,
    overscan,
  });

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ overflow: "auto", contain: "strict" }}
      role="list"
      aria-label={ariaLabel}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            role="listitem"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderItem(items[virtualRow.index], virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
