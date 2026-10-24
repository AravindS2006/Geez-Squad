import { managementInsights, type OperationsData } from '@/lib/studio-operations';
export function OperationsInsights({
  data,
  today,
  view,
  onNavigate,
}: {
  data: OperationsData;
  today: string;
  view: string;
  onNavigate: (view: string) => void;
}) {
  const insight = managementInsights(data, today);
  return (
    <section className="panel operations-insights" aria-label="Studio management priorities">
      <h2>{view === 'staff' ? 'Coach workload & coverage' : 'Your next studio priorities'}</h2>
      <div className="operations-insights-grid">
        <article>
          <span>Renewals in the next seven days</span>
          <strong>{insight.expiring.length}</strong>
          <small>
            {insight.expiring
              .slice(0, 3)
              .map((m) => m.name)
              .join(', ') || 'No renewals due'}
          </small>
          <button className="text-link" onClick={() => onNavigate('memberships')}>
            Manage memberships
          </button>
        </article>
        <article>
          <span>No studio check-in in seven days</span>
          <strong>{insight.quiet.length}</strong>
          <small>Active members · Online training is tracked separately.</small>
          <button className="text-link" onClick={() => onNavigate('attendance')}>
            Review attendance
          </button>
        </article>
        <article>
          <span>Connected members without a primary coach</span>
          <strong>{insight.unassigned}</strong>
          <small>Assign a coach for ongoing training and nutrition support.</small>
          <button className="text-link" onClick={() => onNavigate('staff')}>
            Manage team & assignments
          </button>
        </article>
      </div>
      {view === 'staff' && (
        <div className="ops-table-scroll">
          <table className="coach-workload">
            <caption>
              Authorized coaches · Scheduled studio workload, today through seven days ahead
            </caption>
            <thead>
              <tr>
                <th>Coach</th>
                <th>Assigned members</th>
                <th>Studio classes</th>
                <th>Teaching time</th>
              </tr>
            </thead>
            <tbody>
              {insight.workload.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.clients}</td>
                  <td>{c.classes}</td>
                  <td>{c.minutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ops-context-note">
            Live online classes appear in Live sessions. Staff directory entries and account
            permissions are managed separately.
          </p>
        </div>
      )}
    </section>
  );
}
