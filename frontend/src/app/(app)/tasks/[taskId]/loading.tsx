import { Skeleton } from "@/components/ui/states";

export default function TaskDetailLoading() {
  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <div className="flex gap-1 mb-6 border-b border-border pb-px">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <Skeleton className="h-[400px]" />
    </div>
  );
}
