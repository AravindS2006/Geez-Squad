import styles from './bar-chart.module.css';

export type BarDatum = { key: string; label: string; value: number; detail?: string };

/**
 * Dependency-free responsive bar chart. Values are drawn exactly as given;
 * the caller decides what a bar means. A visually hidden table carries the
 * same data for screen readers.
 */
export function BarChart({
  data,
  caption,
  unit = '',
  height = 160,
}: {
  data: BarDatum[];
  caption: string;
  unit?: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  return (
    <figure className={styles.figure}>
      <div className={styles.plot} style={{ height }} aria-hidden>
        {[1, 0.5].map((tick) => (
          <span key={tick} className={styles.grid} style={{ bottom: `${tick * 100}%` }}>
            <em>
              {Math.round(max * tick)}
              {unit}
            </em>
          </span>
        ))}
        {data.map((d) => (
          <div
            key={d.key}
            className={styles.col}
            title={d.detail ?? `${d.label}: ${d.value}${unit}`}
          >
            <span
              className={d.value ? styles.bar : styles.empty}
              style={{ height: d.value ? `${Math.max(3, (d.value / max) * 100)}%` : undefined }}
            />
          </div>
        ))}
      </div>
      <div className={styles.axis} aria-hidden>
        {data.map((d, i) => (
          <span key={d.key}>{i % labelEvery === 0 || i === data.length - 1 ? d.label : ''}</span>
        ))}
      </div>
      <figcaption className={styles.caption}>{caption}</figcaption>
      <table className={styles.srOnly}>
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>
                {d.value}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
