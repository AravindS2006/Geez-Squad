import styles from './skeleton.module.css';

/** Placeholder block shown while server data streams in. */
export function Skeleton({
  width,
  height = 16,
  radius,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}) {
  return (
    <span className={styles.block} style={{ width, height, borderRadius: radius }} aria-hidden />
  );
}

/** Full workspace placeholder: sidebar, header and card grid. */
export function WorkspaceSkeleton({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className={styles.shell} role="status" aria-live="polite">
      <span className={styles.srOnly}>{label}…</span>
      <aside className={styles.sidebar}>
        <Skeleton width={140} height={28} />
        <Skeleton height={52} radius={12} />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} width={`${70 - (i % 3) * 12}%`} height={14} />
        ))}
      </aside>
      <main className={styles.main}>
        <Skeleton width={180} height={12} />
        <Skeleton width="min(420px, 80%)" height={34} />
        <div className={styles.grid}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.card}>
              <Skeleton width="50%" height={12} />
              <Skeleton width={64} height={30} />
              <Skeleton width="70%" height={12} />
            </div>
          ))}
        </div>
        <div className={styles.wide} />
      </main>
    </div>
  );
}
