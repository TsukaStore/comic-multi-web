import { Link } from "@tanstack/react-router";

import { proxyUrl, type ComicBrief } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function ComicCard({ comic }: { comic: ComicBrief }) {
  return (
    <Link
      to="/comic/$sourceKey/$id"
      params={{ sourceKey: comic.sourceKey, id: comic.id }}
      className="group flex flex-col gap-2"
    >
      <div className="relative aspect-3/4 overflow-hidden rounded-lg border border-border bg-muted">
        {comic.cover ? (
          <img
            src={proxyUrl(comic.cover, comic.sourceKey)}
            alt={comic.title}
            loading="lazy"
            className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            无封面
          </div>
        )}
        <div className="absolute left-1.5 top-1.5">
          <Badge variant="secondary" className="text-xs font-normal">
            {comic.sourceKey}
          </Badge>
        </div>
        {comic.pageCount ? (
          <div className="absolute bottom-1.5 right-1.5 rounded-md bg-background/85 px-2 py-0.5 text-xs text-muted-foreground backdrop-blur-sm">
            {comic.pageCount}p
          </div>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-sm leading-snug text-foreground wrap-anywhere group-hover:text-primary">
          {comic.title}
        </div>
        {comic.subTitle ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {comic.subTitle}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export function ComicGrid({ comics }: { comics: ComicBrief[] }) {
  if (!comics.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {comics.map((c) => (
        <ComicCard key={`${c.sourceKey}:${c.id}`} comic={c} />
      ))}
    </div>
  );
}

export function ComicGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-3/4 w-full rounded-lg" />
          <Skeleton className="h-3.5 w-[80%]" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
