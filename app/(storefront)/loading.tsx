export default function StorefrontLoading() {
  return (
    <div className="space-y-4">
      <div className="h-40 animate-pulse rounded-[2rem] bg-white/70" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-80 animate-pulse rounded-[2rem] bg-white/70" />
        ))}
      </div>
    </div>
  );
}
