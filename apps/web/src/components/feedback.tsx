import { Loader2 } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Spinner({
  label = "加载中",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-6 animate-spin" />
      <span className="text-base">{label}</span>
    </div>
  );
}

export function Empty({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-2 px-1 py-20 text-center">
      <p className="text-base text-muted-foreground wrap-anywhere">
        {title}
      </p>
      {desc ? (
        <p className="max-w-full text-sm text-muted-foreground/70 wrap-anywhere sm:max-w-sm">
          {desc}
        </p>
      ) : null}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: PropsWithChildren<{ action?: ReactNode }>) {
  return (
    <div className="mb-3.5 flex items-end justify-between gap-3">
      <h2 className="text-base font-medium tracking-tight text-foreground">{children}</h2>
      {action}
    </div>
  );
}
