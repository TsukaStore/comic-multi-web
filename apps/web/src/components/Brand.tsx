import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

type BrandProps = {
  compact?: boolean;
  className?: string;
};

/** Understated wordmark — no heavy icon chrome */
export function Brand({ compact = false, className }: BrandProps) {
  return (
    <Link
      to="/"
      className={cn(
        "group inline-flex min-w-0 items-baseline gap-1.5 rounded-md outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span
        className={cn(
          "font-heading font-medium tracking-tight text-foreground transition-colors group-hover:text-primary",
          compact ? "text-lg" : "text-xl",
        )}
      >
        Comic
        <span className="font-normal text-muted-foreground">Multi</span>
      </span>
      {!compact ? (
        <span className="text-sm text-muted-foreground/55">· 阅读</span>
      ) : null}
    </Link>
  );
}
