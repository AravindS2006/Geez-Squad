'use client';

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Users,
  CreditCard,
  CalendarCheck,
  Wallet,
  Check,
  Search,
  Download,
  Clock3,
  Sparkles,
  ChevronRight,
  Pencil,
  Phone,
  Mail,
  MapPin,
  Building2,
  Printer,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { Avatar, EmptyState, Modal } from './ui';
import { fetchJson } from '@/lib/client';
import {
  addDays,
  applyDemoOperation,
  currentTerm,
  demoOperations,
  money,
  operationsSchema,
  outstanding,
  studioToday,
  termStatus,
  type OperationsData,
  type OperationsCommand,
  type StudioMember,
  type MembershipOffer,
  type StudioEnquiry,
  type StudioStaff,
  type StudioPayment,
} from '@/lib/studio-operations';
import type { WorkspaceData } from '@/lib/types';
import { StudioSchedule } from './studio-schedule';

const operationViews = [
  'dashboard',
  'members',
  'memberships',
  'attendance',
  'payments',
  'enquiries',
  'staff',
  'studio-details',
  'classes',
];
type Editor = {
  kind: 'member' | 'offer' | 'term' | 'payment' | 'enquiry' | 'staff' | 'receipt';
  id?: string;
  memberId?: string;
  name?: string;
  phone?: string;
};
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`ops-badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function CardHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ops-card-heading">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
function exportCsv(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) =>
    `"${String(v)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + rows.map((r) => r.map(escape).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function StudioOperations({
  view,
  workspace,
  search,
  onNavigate,
  onSchedule,
}: {
  view: string;
  workspace: WorkspaceData;
  search: string;
  onNavigate: (view: string) => void;
  onSchedule: () => void;
}) {
  const [data, setData] = useState<OperationsData | null>(() =>
    workspace.demo ? demoOperations() : null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!workspace.demo);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [localSearch, setLocalSearch] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(studioToday);
  const [period, setPeriod] = useState('month');
  const [today, setToday] = useState(studioToday);
  const lock = useRef(false);
  const paymentRequest = useRef('');
  useEffect(() => {
    const timer = setInterval(() => setToday(studioToday()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (workspace.demo) return;
    const controller = new AbortController();
    fetchJson<OperationsData>('/api/studio-operations', { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspace.demo]);
  useEffect(() => {
    setFilter('all');
    setLocalSearch('');
    setSelected(null);
    setEditor(null);
    setError('');
  }, [view]);
  async function reload() {
    setLoading(true);
    setError('');
    try {
      setData(await fetchJson<OperationsData>('/api/studio-operations'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load studio.');
    } finally {
      setLoading(false);
    }
  }
  function open(next: Editor) {
    setError('');
    paymentRequest.current = crypto.randomUUID();
    setEditor(next);
  }
  async function save(command: OperationsCommand) {
    if (lock.current || !data) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const parsed = operationsSchema.parse(command);
      if (workspace.demo) setData(applyDemoOperation(data, parsed, crypto.randomUUID()));
      else {
        await fetchJson('/api/studio-operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });
        try {
          setData(await fetchJson<OperationsData>('/api/studio-operations'));
        } catch {
          setNotice('Saved successfully. Refresh to load the latest studio records.');
          setEditor(null);
          return true;
        }
      }
      setEditor(null);
      setNotice('Studio updated successfully.');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please check the fields and retry.');
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!operationViews.includes(view)) return null;
  if (!data)
    return (
      <section className="panel ops-loading" aria-live="polite">
        <Building2 size={32} />
        <h2>{loading ? 'Opening your studio…' : 'Studio unavailable'}</h2>
        {error && <p role="alert">{error}</p>}
        {!loading && (
          <button className="button dark" onClick={reload}>
            <RefreshCw size={16} />
            Try again
          </button>
        )}
      </section>
    );
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const memberName = (id: string) => memberById.get(id)?.name || 'Member';
  const termById = new Map(data.terms.map((t) => [t.id, t]));
  const activeMembers = data.members.filter(
    (m) =>
      m.status === 'active' &&
      data.terms.some((t) => t.memberId === m.id && termStatus(t, today) === 'active'),
  );
  const monthStart = today.slice(0, 7) + '-01';
  const lastMonthEnd = addDays(monthStart, -1),
    lastMonthStart = lastMonthEnd.slice(0, 7) + '-01';
  const periodStart =
    period === 'quarter' ? addDays(today, -89) : period === 'last' ? lastMonthStart : monthStart;
  const periodEnd = period === 'last' ? lastMonthEnd : today;
  const periodPayments = data.payments.filter(
    (p) => p.paidOn >= periodStart && p.paidOn <= periodEnd,
  );
  const collected = periodPayments.reduce((sum, p) => sum + p.amountPaise, 0);
  const dueTerms = data.terms.filter(
    (t) => t.status !== 'cancelled' && t.startsOn <= today && outstanding(t, data.payments) > 0,
  );
  const totalDue = dueTerms.reduce((sum, t) => sum + outstanding(t, data.payments), 0);
  const renewals = data.terms.filter(
    (t) =>
      termStatus(t, today) === 'active' &&
      t.endsOn <= addDays(today, 7) &&
      !data.terms.some(
        (n) => n.memberId === t.memberId && n.startsOn > t.endsOn && n.status !== 'cancelled',
      ),
  );
  const visits = data.attendance.filter((a) => a.date === today);
  const enquiryDue = data.enquiries.filter(
    (e) => !['won', 'lost'].includes(e.stage) && e.followUpOn <= today,
  );
  const query = (localSearch || search).trim().toLowerCase();
  const matches = (...values: string[]) => values.some((v) => v.toLowerCase().includes(query));
  const members = data.members.filter(
    (m) =>
      matches(m.name, m.email, m.phone) &&
      (filter === 'all' ||
        (filter === 'active'
          ? activeMembers.some((a) => a.id === m.id)
          : filter === 'due'
            ? dueTerms.some((t) => t.memberId === m.id)
            : filter === 'expiring'
              ? renewals.some((t) => t.memberId === m.id)
              : m.status === filter)),
  );
  const selectedMember = data.members.find((m) => m.id === selected);
  const upcoming = [
    ...workspace.classes
      .filter((c) => c.status === 'scheduled' || c.status === 'live')
      .map((c) => ({ ...c, physical: false })),
    ...data.studioClasses
      .filter((c) => c.status === 'scheduled' && Date.parse(c.startsAt) > Date.now())
      .map((c) => ({
        ...c,
        physical: true,
        participantCount: c.bookings.filter((b) => b.status === 'booked').length,
        participants: [],
      })),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const title = (
    {
      dashboard: 'A stronger studio starts here.',
      members: 'Your people. Your squad.',
      memberships: 'Memberships that move with you.',
      attendance: 'Every visit counts.',
      payments: 'A clear view of every rupee.',
      enquiries: 'Turn a hello into a habit.',
      staff: 'The people behind the progress.',
      'studio-details': 'Make this studio yours.',
      classes: 'Good energy. On the studio floor.',
    } as Record<string, string>
  )[view];
  const subtitle = (
    {
      dashboard: `Welcome back, ${workspace.user.name.split(' ')[0]}. Here’s how your studio is moving.`,
      members: 'One home for your members, memberships, and next steps.',
      memberships: 'Create plans, assign memberships, and stay ahead of renewals.',
      attendance: 'A simple, reliable register for your in-studio members.',
      payments: 'Record collections, follow up balances, and keep receipts together.',
      enquiries: 'Keep conversations moving, from first enquiry to first session.',
      staff: 'Manage your studio’s trainers and support team.',
      'studio-details': 'Keep your contact details and studio information up to date.',
      classes: 'Schedule in-studio classes, book your members, and keep every place accounted for.',
    } as Record<string, string>
  )[view];
  const primary = (
    {
      members: 'Add member',
      memberships: 'Create plan',
      payments: 'Record payment',
      enquiries: 'Add enquiry',
      staff: 'Add staff',
    } as Record<string, string>
  )[view];
  function exportMembers() {
    exportCsv('geez-squad-members.csv', [
      ['Name', 'Email', 'Phone', 'Status', 'Joined', 'Plan', 'Membership ends', 'Balance INR'],
      ...members.map((m) => {
        const t = currentTerm(data!, m.id, today);
        return [
          m.name,
          m.email,
          m.phone,
          m.status,
          m.joinedOn,
          t?.planName || '',
          t?.endsOn || '',
          data!.terms
            .filter((t) => t.memberId === m.id && t.status !== 'cancelled')
            .reduce((s, t) => s + outstanding(t, data!.payments), 0) / 100,
        ];
      }),
    ]);
  }
  function memberTable(rows: StudioMember[]) {
    if (!data) return null;
    return (
      <div className="ops-table-scroll">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Membership</th>
              <th>Status</th>
              <th>Valid until</th>
              <th>Balance</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const t = currentTerm(data, m.id, today);
              const status =
                m.status !== 'active' ? m.status : t ? termStatus(t, today) : 'no plan';
              const due = data.terms
                .filter((t) => t.memberId === m.id && t.status !== 'cancelled')
                .reduce((s, t) => s + outstanding(t, data.payments), 0);
              return (
                <tr key={m.id}>
                  <td>
                    <button className="ops-person" onClick={() => setSelected(m.id)}>
                      <Avatar name={m.name} index={i} small />
                      <span>
                        <strong>{m.name}</strong>
                        <small>{m.email || m.phone || 'In-studio member'}</small>
                      </span>
                    </button>
                  </td>
                  <td>{t?.planName || <span className="ops-muted">Not assigned</span>}</td>
                  <td>
                    <Badge
                      tone={status === 'active' ? 'green' : status === 'expired' ? 'red' : 'amber'}
                    >
                      {status}
                    </Badge>
                  </td>
                  <td>{t ? shortDate(t.endsOn) : '—'}</td>
                  <td className={due ? 'ops-due' : ''}>
                    {due ? money(due) : <span className="ops-muted">All clear</span>}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`View ${m.name}`}
                      onClick={() => setSelected(m.id)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <EmptyState
            title="No members here yet"
            text={
              query
                ? 'Try another name, email, or phone number.'
                : 'Add your first member to start building your squad.'
            }
            action={
              <button className="button dark" onClick={() => open({ kind: 'member' })}>
                <Plus size={16} />
                Add member
              </button>
            }
          />
        )}
      </div>
    );
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor) return;
    const f = new FormData(e.currentTarget),
      str = (key: string) => String(f.get(key) || ''),
      num = (key: string) => Number(f.get(key));
    const kind = editor.kind;
    if (kind === 'member')
      await save({
        action: kind,
        id: editor.id,
        name: str('name'),
        email: str('email'),
        phone: str('phone'),
        goal: str('goal'),
        joinedOn: str('joinedOn'),
        status: str('status') as 'active',
      });
    if (kind === 'offer')
      await save({
        action: kind,
        id: editor.id,
        name: str('name'),
        description: str('description'),
        durationDays: num('durationDays'),
        pricePaise: Math.round(num('price') * 100),
        active: str('active') === 'true',
      });
    if (kind === 'term')
      await save({
        action: kind,
        memberId: str('memberId'),
        offerId: str('offerId'),
        startsOn: str('startsOn'),
      });
    if (kind === 'payment')
      await save({
        action: kind,
        id: paymentRequest.current,
        termId: str('termId'),
        amountPaise: Math.round(num('amount') * 100),
        paidOn: str('paidOn'),
        method: str('method') as 'UPI',
        reference: str('reference'),
      });
    if (kind === 'enquiry')
      await save({
        action: kind,
        id: editor.id,
        name: str('name'),
        phone: str('phone'),
        interest: str('interest'),
        source: str('source') as 'Walk-in',
        stage: str('stage') as 'new',
        followUpOn: str('followUpOn'),
        note: str('note'),
      });
    if (kind === 'staff')
      await save({
        action: kind,
        id: editor.id,
        name: str('name'),
        email: str('email'),
        phone: str('phone'),
        role: str('role'),
        specialty: str('specialty'),
        status: str('status') as 'active',
      });
  }
  const editMember =
    editor?.kind === 'member' ? data.members.find((m) => m.id === editor.id) : undefined;
  const editOffer =
    editor?.kind === 'offer' ? data.offers.find((m) => m.id === editor.id) : undefined;
  const editEnquiry =
    editor?.kind === 'enquiry' ? data.enquiries.find((m) => m.id === editor.id) : undefined;
  const editStaff =
    editor?.kind === 'staff' ? data.staff.find((m) => m.id === editor.id) : undefined;
  const receipt =
    editor?.kind === 'receipt' ? data.payments.find((p) => p.id === editor.id) : undefined;
  const editorTitle = editor
    ? {
        member: editor.id ? 'Edit member' : 'Add a new member',
        offer: editor.id ? 'Edit membership plan' : 'Create a membership plan',
        term: 'Assign or renew membership',
        payment: 'Record a payment',
        enquiry: editor.id ? 'Update enquiry' : 'Add an enquiry',
        staff: editor.id ? 'Edit staff member' : 'Add a staff member',
        receipt: 'Payment receipt',
      }[editor.kind]
    : '';
  return (
    <div className="ops-workspace">
      <div className="ops-heading">
        <div>
          <div className="ops-eyebrow">
            <span />
            GEEZ SQUAD · STUDIO MANAGEMENT
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="ops-heading-actions">
          {view === 'dashboard' ? (
            <>
              <span className="ops-date">
                <CalendarCheck size={15} />
                {shortDate(today)}
              </span>
              <button className="button dark" onClick={() => open({ kind: 'member' })}>
                <Plus size={16} />
                Add member
              </button>
            </>
          ) : primary ? (
            <button
              className="button dark"
              onClick={() =>
                open({
                  kind: (
                    {
                      members: 'member',
                      memberships: 'offer',
                      payments: 'payment',
                      enquiries: 'enquiry',
                      staff: 'staff',
                    } as Record<string, Editor['kind']>
                  )[view],
                })
              }
            >
              <Plus size={16} />
              {primary}
            </button>
          ) : null}
        </div>
      </div>
      {[
        'members',
        'memberships',
        'attendance',
        'payments',
        'enquiries',
        'staff',
        'classes',
      ].includes(view) && (
        <label className="ops-mobile-search">
          <span className="sr-only">Search studio records</span>
          <Search size={16} />
          <input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search studio records…"
          />
        </label>
      )}
      {notice && (
        <div className="ops-notice" role="status">
          <Check size={16} />
          {notice}
          <button aria-label="Dismiss update" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      {error && !editor && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {view === 'dashboard' && (
        <>
          <div className="ops-stats">
            {[
              {
                label: 'Active members',
                value: activeMembers.length,
                detail: `${data.members.filter((m) => m.status !== 'archived').length} members in your squad`,
                icon: Users,
                tone: 'mint',
                view: 'members',
              },
              {
                label: 'Collections this month',
                value: money(
                  data.payments
                    .filter((p) => p.paidOn >= monthStart && p.paidOn <= today)
                    .reduce((s, p) => s + p.amountPaise, 0),
                ),
                detail: 'Payments recorded in your studio',
                icon: Wallet,
                tone: 'lilac',
                view: 'payments',
              },
              {
                label: 'Checked in today',
                value: visits.length,
                detail: 'Unique in-studio visits',
                icon: CalendarCheck,
                tone: 'sand',
                view: 'attendance',
              },
              {
                label: 'Renewals in 7 days',
                value: renewals.length,
                detail: renewals.length
                  ? 'A little nudge goes a long way'
                  : 'Your renewals are up to date',
                icon: CreditCard,
                tone: 'lime',
                view: 'memberships',
              },
            ].map((k) => (
              <button key={k.label} className="ops-stat" onClick={() => onNavigate(k.view)}>
                <div>
                  <span>{k.label}</span>
                  <span className={`ops-stat-icon ${k.tone}`}>
                    <k.icon size={19} />
                  </span>
                </div>
                <strong>{k.value}</strong>
                <small>
                  {k.detail}
                  <ArrowUpRight size={13} />
                </small>
              </button>
            ))}
          </div>
          <div className="ops-dashboard-grid">
            <section className="ops-card ops-revenue">
              <CardHeading
                title="Studio collections"
                detail="Real payments. A healthier business."
                action={
                  <select
                    aria-label="Collection period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  >
                    <option value="month">This month</option>
                    <option value="last">Last month</option>
                    <option value="quarter">Last 90 days</option>
                  </select>
                }
              />
              <div className="ops-revenue-total">
                <strong>{money(collected)}</strong>
                <span>{periodPayments.length} recorded payments</span>
              </div>
              <div
                className="ops-bar-chart"
                role="img"
                aria-label="Monthly studio collections for the last six months"
              >
                {Array.from({ length: 6 }, (_, i) => {
                  const d = new Date(`${monthStart}T12:00:00Z`);
                  d.setUTCMonth(d.getUTCMonth() - 5 + i);
                  const month = d.toISOString().slice(0, 7);
                  const amount = data.payments
                    .filter((p) => p.paidOn.startsWith(month) && p.paidOn <= today)
                    .reduce((s, p) => s + p.amountPaise, 0);
                  const max = Math.max(
                    ...Array.from({ length: 6 }, (_, j) => {
                      const x = new Date(`${monthStart}T12:00:00Z`);
                      x.setUTCMonth(x.getUTCMonth() - j);
                      return data.payments
                        .filter((p) => p.paidOn.startsWith(x.toISOString().slice(0, 7)))
                        .reduce((s, p) => s + p.amountPaise, 0);
                    }),
                    1,
                  );
                  return (
                    <div className="ops-bar-column" key={month}>
                      <span>{amount ? money(amount) : '—'}</span>
                      <div className="ops-bar-track">
                        <div
                          className={i === 5 ? 'current' : ''}
                          style={{ height: `${Math.max((amount / max) * 100, 1)}%` }}
                        />
                      </div>
                      <small>
                        {d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}
                      </small>
                    </div>
                  );
                })}
              </div>
              <div className="ops-chart-footer">
                <span>
                  <i />
                  Monthly collections · INR
                </span>
                <button onClick={() => onNavigate('payments')}>
                  View payments
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </section>
            <section className="ops-card ops-agenda">
              <CardHeading
                title="On the studio floor"
                detail="A little structure. A lot of progress."
                action={
                  <span className="ops-mini-icon">
                    <CalendarCheck size={19} />
                  </span>
                }
              />
              <div className="ops-agenda-date">
                <span>TODAY’S PULSE</span>
                <strong>{visits.length} members showed up</strong>
                <div className="ops-avatar-stack">
                  {visits.slice(0, 5).map((v, i) => (
                    <Avatar key={v.id} name={memberName(v.memberId)} index={i} small />
                  ))}
                  {visits.length > 5 && <span>+{visits.length - 5}</span>}
                </div>
              </div>
              <h3>Coming up next</h3>
              {upcoming.slice(0, 2).map((c) => (
                <button
                  key={c.id}
                  className="ops-agenda-row"
                  onClick={() => onNavigate(c.physical ? 'classes' : 'sessions')}
                >
                  <span className="ops-session-time">
                    {new Date(c.startsAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })}
                    <small>
                      {new Date(c.startsAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </small>
                  </span>
                  <span>
                    <strong>{c.title}</strong>
                    <small>
                      {c.duration} min · {c.participantCount ?? c.participants.length} booked ·{' '}
                      {c.physical ? 'In studio' : 'Online'}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {!upcoming.length && (
                <p className="ops-muted">Your next great session starts with a plan.</p>
              )}
              <button className="button outline full" onClick={onSchedule}>
                <Plus size={15} />
                Schedule a session
              </button>
            </section>
          </div>
          <div className="ops-dashboard-grid ops-secondary-grid">
            <section className="ops-card">
              <CardHeading
                title="Your growing squad"
                detail="A familiar face behind every membership."
                action={
                  <button className="text-link" onClick={() => onNavigate('members')}>
                    All members
                    <ArrowUpRight size={15} />
                  </button>
                }
              />
              {memberTable(data.members.filter((m) => m.status !== 'archived').slice(0, 5))}
            </section>
            <section className="ops-card ops-attention">
              <CardHeading
                title="A little attention"
                detail="Small follow-ups. Stronger connections."
              />
              <button className="ops-attention-row" onClick={() => onNavigate('memberships')}>
                <span className="ops-stat-icon sand">
                  <Clock3 size={19} />
                </span>
                <span>
                  <strong>{renewals.length} upcoming renewals</strong>
                  <small>Memberships ending in the next 7 days</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <button className="ops-attention-row" onClick={() => onNavigate('payments')}>
                <span className="ops-stat-icon lilac">
                  <Wallet size={19} />
                </span>
                <span>
                  <strong>{money(totalDue)} to collect</strong>
                  <small>{dueTerms.length} membership balances to follow up</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <button className="ops-attention-row" onClick={() => onNavigate('enquiries')}>
                <span className="ops-stat-icon mint">
                  <UserPlus size={19} />
                </span>
                <span>
                  <strong>{enquiryDue.length} enquiries to follow up</strong>
                  <small>Keep their first step moving forward</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <div className="ops-coaching-callout">
                <Sparkles size={20} />
                <h3>Better together.</h3>
                <p>Your live coaching, workout plans, and progress tools are right here too.</p>
                <button className="text-link" onClick={() => onNavigate('coaching')}>
                  Open coaching overview
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
          </div>
        </>
      )}
      {view === 'members' && (
        <section className="ops-card">
          <div className="ops-toolbar">
            <div className="ops-tabs" role="group" aria-label="Member filters">
              {['all', 'active', 'expiring', 'due', 'paused', 'archived'].map((s) => (
                <button
                  key={s}
                  aria-pressed={filter === s}
                  className={filter === s ? 'active' : ''}
                  onClick={() => setFilter(s)}
                >
                  {
                    {
                      all: 'All members',
                      active: 'Active',
                      expiring: 'Expiring soon',
                      due: 'Balance due',
                      paused: 'Paused',
                      archived: 'Archived',
                    }[s]
                  }
                </button>
              ))}
            </div>
            <button className="button outline small-button" onClick={exportMembers}>
              <Download size={15} />
              Export
            </button>
          </div>
          <div className="ops-table-caption">
            {members.length} members{query ? ` matching “${search}”` : ''}
          </div>
          {memberTable(members)}
        </section>
      )}
      {view === 'memberships' && (
        <>
          <div className="ops-plan-grid">
            {data.offers
              .filter((p) => matches(p.name, p.description))
              .map((p, i) => (
                <section className={`ops-plan-card ${i % 3 === 1 ? 'featured' : ''}`} key={p.id}>
                  <div className="ops-plan-top">
                    <span className="ops-plan-symbol">
                      <CreditCard size={24} />
                    </span>
                    <Badge tone={p.active ? 'green' : 'amber'}>
                      {p.active ? 'Available' : 'Hidden'}
                    </Badge>
                  </div>
                  <h2>{p.name}</h2>
                  <p>{p.description || 'A membership designed for your studio.'}</p>
                  <div className="ops-plan-price">
                    {money(p.pricePaise)}
                    <small>/ {p.durationDays} days</small>
                  </div>
                  <div className="ops-plan-meta">
                    <Users size={15} />
                    {
                      data.terms.filter(
                        (t) => t.offerId === p.id && termStatus(t, today) === 'active',
                      ).length
                    }{' '}
                    active memberships
                  </div>
                  <div className="ops-plan-buttons">
                    <button
                      className="button dark"
                      disabled={!p.active}
                      onClick={() => open({ kind: 'term' })}
                    >
                      Assign plan
                      <ArrowUpRight size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => open({ kind: 'offer', id: p.id })}
                    >
                      <Pencil size={17} />
                    </button>
                  </div>
                </section>
              ))}
          </div>
          {!data.offers.length && (
            <EmptyState
              title="Build your first membership plan"
              text="Set your price and duration. Then assign it to a member."
              action={
                <button className="button dark" onClick={() => open({ kind: 'offer' })}>
                  Create plan
                </button>
              }
            />
          )}
          <section className="ops-card">
            <CardHeading
              title="Membership register"
              detail={`${renewals.length} renewals coming up in the next 7 days`}
              action={
                <button
                  className="button outline small-button"
                  onClick={() => open({ kind: 'term' })}
                >
                  <Plus size={15} />
                  Assign membership
                </button>
              }
            />
            <div className="ops-table-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Plan</th>
                    <th>Term</th>
                    <th>Status</th>
                    <th>Fee</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.terms
                    .filter((t) => matches(memberName(t.memberId), t.planName))
                    .map((t) => (
                      <tr key={t.id}>
                        <td>
                          <button className="text-link" onClick={() => setSelected(t.memberId)}>
                            {memberName(t.memberId)}
                          </button>
                        </td>
                        <td>{t.planName}</td>
                        <td>
                          {shortDate(t.startsOn)} → {shortDate(t.endsOn)}
                        </td>
                        <td>
                          <Badge tone={termStatus(t, today) === 'active' ? 'green' : 'amber'}>
                            {termStatus(t, today)}
                          </Badge>
                        </td>
                        <td>{money(t.feePaise)}</td>
                        <td>
                          {t.status !== 'cancelled' && (
                            <button
                              className="text-link"
                              onClick={() => open({ kind: 'term', memberId: t.memberId })}
                            >
                              Renew
                              <ArrowUpRight size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!data.terms.length && (
                <p className="ops-empty-text">Assigned memberships will appear here.</p>
              )}
            </div>
          </section>
        </>
      )}
      {view === 'attendance' && (
        <section className="ops-card">
          <CardHeading
            title="Studio attendance"
            detail="One check-in per member per day · India time"
            action={
              <input
                type="date"
                aria-label="Attendance date"
                value={attendanceDate}
                max={today}
                onChange={(e) => setAttendanceDate(e.target.value || today)}
              />
            }
          />
          <div className="ops-attendance-summary">
            <span className="ops-stat-icon mint">
              <CalendarCheck size={22} />
            </span>
            <div>
              <strong>
                {data.attendance.filter((a) => a.date === attendanceDate).length} checked in
              </strong>
              <p>
                {shortDate(attendanceDate)} · In-studio attendance is separate from online workout
                activity.
              </p>
            </div>
          </div>
          <div className="ops-table-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Membership</th>
                  <th>Visit status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.members
                  .filter((m) => m.status !== 'archived' && matches(m.name, m.email, m.phone))
                  .map((m, i) => {
                    const checked = data.attendance.some(
                      (a) => a.memberId === m.id && a.date === attendanceDate,
                    );
                    const eligible =
                      m.status === 'active' &&
                      data.terms.some(
                        (t) => t.memberId === m.id && termStatus(t, attendanceDate) === 'active',
                      );
                    return (
                      <tr key={m.id}>
                        <td>
                          <span className="ops-person">
                            <Avatar name={m.name} index={i} small />
                            <strong>{m.name}</strong>
                          </span>
                        </td>
                        <td>
                          {eligible ? (
                            <Badge tone="green">Active membership</Badge>
                          ) : (
                            <Badge tone="amber">Membership required</Badge>
                          )}
                        </td>
                        <td>
                          {checked ? (
                            <span className="ops-check">
                              <Check size={15} />
                              Checked in
                            </span>
                          ) : (
                            <span className="ops-muted">Not checked in</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="button outline small-button"
                            disabled={checked || !eligible || busy || attendanceDate > today}
                            onClick={() =>
                              save({ action: 'attendance', memberId: m.id, date: attendanceDate })
                            }
                          >
                            {checked ? <Check size={15} /> : <Plus size={15} />}Check in
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {!data.members.length && (
              <p className="ops-empty-text">
                Add members and assign memberships to start checking in.
              </p>
            )}
          </div>
        </section>
      )}
      {view === 'payments' && (
        <>
          <div className="ops-finance-summary">
            <div>
              <span>COLLECTED THIS MONTH</span>
              <strong>
                {money(
                  data.payments
                    .filter((p) => p.paidOn >= monthStart && p.paidOn <= today)
                    .reduce((s, p) => s + p.amountPaise, 0),
                )}
              </strong>
            </div>
            <div>
              <span>OUTSTANDING BALANCE</span>
              <strong>{money(totalDue)}</strong>
            </div>
            <div>
              <span>MEMBERSHIPS WITH BALANCE</span>
              <strong>{dueTerms.length}</strong>
            </div>
            <Wallet className="ops-finance-watermark" size={100} />
          </div>
          <section className="ops-card">
            <CardHeading
              title="Payment records"
              detail="Manual collection ledger · recording a payment does not charge a card."
              action={
                <button
                  className="button outline small-button"
                  onClick={() =>
                    exportCsv('geez-squad-payments.csv', [
                      ['Receipt', 'Member', 'Plan', 'Amount INR', 'Date', 'Method', 'Reference'],
                      ...data.payments.map((p) => {
                        const t = termById.get(p.termId);
                        return [
                          p.id,
                          t ? memberName(t.memberId) : '',
                          t?.planName || '',
                          p.amountPaise / 100,
                          p.paidOn,
                          p.method,
                          p.reference,
                        ];
                      }),
                    ])
                  }
                >
                  <Download size={15} />
                  Export
                </button>
              }
            />
            <div className="ops-toolbar">
              <div className="ops-tabs" role="group" aria-label="Payment view">
                <button
                  className={filter === 'all' ? 'active' : ''}
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                >
                  All payments
                </button>
                <button
                  className={filter === 'due' ? 'active' : ''}
                  aria-pressed={filter === 'due'}
                  onClick={() => setFilter('due')}
                >
                  Outstanding balances
                </button>
              </div>
            </div>
            <div className="ops-table-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Membership</th>
                    <th>Amount</th>
                    <th>{filter === 'due' ? 'Valid until' : 'Paid on'}</th>
                    <th>{filter === 'due' ? 'Status' : 'Method'}</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filter === 'due'
                    ? dueTerms
                        .filter((t) => matches(memberName(t.memberId), t.planName))
                        .map((t) => (
                          <tr key={t.id}>
                            <td>{memberName(t.memberId)}</td>
                            <td>{t.planName}</td>
                            <td className="ops-due">{money(outstanding(t, data.payments))}</td>
                            <td>{shortDate(t.endsOn)}</td>
                            <td>
                              <Badge tone="amber">Balance due</Badge>
                            </td>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => open({ kind: 'payment', id: t.id })}
                              >
                                Record payment
                                <Plus size={14} />
                              </button>
                            </td>
                          </tr>
                        ))
                    : data.payments
                        .filter((p) => {
                          const t = termById.get(p.termId);
                          return matches(t ? memberName(t.memberId) : '', p.reference, p.method);
                        })
                        .map((p) => {
                          const t = termById.get(p.termId);
                          return (
                            <tr key={p.id}>
                              <td>{t ? memberName(t.memberId) : 'Member'}</td>
                              <td>{t?.planName}</td>
                              <td>
                                <strong>{money(p.amountPaise)}</strong>
                              </td>
                              <td>{shortDate(p.paidOn)}</td>
                              <td>
                                <Badge tone="green">{p.method}</Badge>
                              </td>
                              <td>
                                <button
                                  className="text-link"
                                  onClick={() => open({ kind: 'receipt', id: p.id })}
                                >
                                  Receipt
                                  <ArrowUpRight size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                </tbody>
              </table>
              {!(filter === 'due' ? dueTerms : data.payments).length && (
                <p className="ops-empty-text">
                  {filter === 'due'
                    ? 'All membership balances are clear.'
                    : 'No payments recorded yet.'}
                </p>
              )}
            </div>
          </section>
        </>
      )}
      {view === 'enquiries' && (
        <>
          <div className="ops-enquiry-summary">
            <span>
              <strong>
                {data.enquiries.filter((e) => !['won', 'lost'].includes(e.stage)).length}
              </strong>{' '}
              open conversations
            </span>
            <span>
              <strong>{enquiryDue.length}</strong> follow-ups due
            </span>
            <span>
              <strong>{data.enquiries.filter((e) => e.stage === 'won').length}</strong> joined the
              squad
            </span>
          </div>
          <div className="ops-kanban">
            {['new', 'contacted', 'trial', 'won', 'lost'].map((stage) => (
              <section className="ops-kanban-column" key={stage}>
                <h2>
                  <span className={`ops-stage-dot ${stage}`} />
                  {
                    {
                      new: 'New enquiries',
                      contacted: 'In conversation',
                      trial: 'Trial planned',
                      won: 'Joined',
                      lost: 'Closed',
                    }[stage]
                  }
                  <small>{data.enquiries.filter((e) => e.stage === stage).length}</small>
                </h2>
                {data.enquiries
                  .filter((e) => e.stage === stage && matches(e.name, e.phone, e.interest))
                  .map((e) => (
                    <button
                      className="ops-lead-card"
                      key={e.id}
                      onClick={() => open({ kind: 'enquiry', id: e.id })}
                    >
                      <span className="ops-lead-source">
                        {e.source}
                        <ArrowUpRight size={14} />
                      </span>
                      <h3>{e.name}</h3>
                      <p>{e.interest}</p>
                      {e.note && <p className="ops-lead-note">{e.note}</p>}
                      <span
                        className={`ops-lead-date ${e.followUpOn <= today && !['won', 'lost'].includes(e.stage) ? 'due' : ''}`}
                      >
                        <Clock3 size={13} />
                        Follow up {shortDate(e.followUpOn)}
                      </span>
                    </button>
                  ))}
                {!data.enquiries.some((e) => e.stage === stage) && (
                  <div className="ops-kanban-empty">Room for a new beginning.</div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {view === 'classes' && (
        <StudioSchedule
          data={data}
          search={localSearch || search}
          save={save}
          busy={busy}
          error={error}
        />
      )}
      {view === 'staff' && (
        <>
          <p className="ops-context-note">
            Your team directory. Staff records do not grant account access; the studio owner manages
            these operations.
          </p>
          <div className="ops-staff-grid">
            {data.staff
              .filter((s) => matches(s.name, s.role, s.specialty))
              .map((s, i) => (
                <section className="ops-card ops-staff-card" key={s.id}>
                  <div className="ops-staff-top">
                    <Avatar name={s.name} index={i} />
                    <button
                      className="icon-button"
                      aria-label={`Edit ${s.name}`}
                      onClick={() => open({ kind: 'staff', id: s.id })}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                  <h2>{s.name}</h2>
                  <span className="ops-staff-role">{s.role}</span>
                  <p>{s.specialty || 'Part of your studio team'}</p>
                  <div className="ops-staff-contact">
                    <Mail size={14} />
                    {s.email || 'Email not added'}
                  </div>
                  <div className="ops-staff-contact">
                    <Phone size={14} />
                    {s.phone || 'Phone not added'}
                  </div>
                  <Badge tone={s.status === 'active' ? 'green' : 'amber'}>{s.status}</Badge>
                </section>
              ))}
          </div>
          {!data.staff.length && (
            <EmptyState
              title="Meet your future team"
              text="Add trainers and studio staff to your directory."
              action={
                <button className="button dark" onClick={() => open({ kind: 'staff' })}>
                  Add staff member
                </button>
              }
            />
          )}
        </>
      )}
      {view === 'studio-details' && (
        <section className="ops-card ops-details">
          <div className="ops-details-intro">
            <span className="ops-details-mark">
              <Building2 size={36} />
            </span>
            <h2>{data.studio.name}</h2>
            <p>The home of your squad.</p>
            <span className="ops-context-note">
              Studio memberships use INR and dates in Asia/Kolkata.
            </span>
          </div>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save({
                action: 'details',
                name: String(f.get('name')),
                phone: String(f.get('phone')),
                address: String(f.get('address')),
                hours: String(f.get('hours')),
              });
            }}
          >
            <Field label="Studio name">
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={data.studio.name}
              />
            </Field>
            <Field label="Contact number">
              <input name="phone" type="tel" maxLength={30} defaultValue={data.studio.phone} />
            </Field>
            <Field label="Studio address">
              <textarea name="address" maxLength={400} defaultValue={data.studio.address} />
            </Field>
            <Field label="Opening hours">
              <input
                name="hours"
                maxLength={160}
                placeholder="Monday – Saturday · 6 am – 9 pm"
                defaultValue={data.studio.hours}
              />
            </Field>
            <button className="button dark" disabled={busy}>
              {busy ? 'Saving…' : 'Save studio details'}
              <Check size={16} />
            </button>
          </form>
        </section>
      )}
      {selectedMember && (
        <Modal title="Member profile" onClose={() => setSelected(null)} wide>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="ops-member-profile">
            <Avatar name={selectedMember.name} />
            <div>
              <h2>{selectedMember.name}</h2>
              <p>
                {selectedMember.email || 'In-studio member'} · Joined{' '}
                {shortDate(selectedMember.joinedOn)}
              </p>
            </div>
            <button
              className="button outline small-button"
              onClick={() => {
                setSelected(null);
                open({ kind: 'member', id: selectedMember.id });
              }}
            >
              <Pencil size={14} />
              Edit
            </button>
          </div>
          <div className="ops-member-details">
            <span>
              <Phone size={14} />
              {selectedMember.phone || 'No phone added'}
            </span>
            <span>
              <Sparkles size={14} />
              {selectedMember.goal || 'No goal added'}
            </span>
            <Badge tone={selectedMember.status === 'active' ? 'green' : 'amber'}>
              {selectedMember.status}
            </Badge>
          </div>
          <div className="ops-profile-actions">
            <button
              className="button dark"
              onClick={() => {
                setSelected(null);
                open({ kind: 'term', memberId: selectedMember.id });
              }}
            >
              Assign / renew membership
              <Plus size={15} />
            </button>
            <button
              className="button outline"
              onClick={() => {
                setSelected(null);
                open({ kind: 'payment', memberId: selectedMember.id });
              }}
            >
              Record payment
            </button>
          </div>
          <h3>Membership history</h3>
          {data.terms
            .filter((t) => t.memberId === selectedMember.id)
            .map((t) => (
              <div className="ops-profile-term" key={t.id}>
                <div>
                  <strong>{t.planName}</strong>
                  <p>
                    {shortDate(t.startsOn)} – {shortDate(t.endsOn)}
                  </p>
                  <Badge tone={termStatus(t, today) === 'active' ? 'green' : 'amber'}>
                    {termStatus(t, today)}
                  </Badge>
                </div>
                <div>
                  <strong>{money(t.feePaise)}</strong>
                  <p>{money(outstanding(t, data.payments))} remaining</p>
                  {t.status !== 'cancelled' && !data.payments.some((p) => p.termId === t.id) && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => save({ action: 'cancelTerm', id: t.id })}
                    >
                      Cancel unpaid term
                    </button>
                  )}
                </div>
              </div>
            ))}
          {!data.terms.some((t) => t.memberId === selectedMember.id) && (
            <p className="ops-empty-text">No membership assigned yet.</p>
          )}
          <h3>Studio visits</h3>
          <p>
            {data.attendance.filter((a) => a.memberId === selectedMember.id).length} visits recorded
            · Last visit:{' '}
            {data.attendance
              .filter((a) => a.memberId === selectedMember.id)
              .sort((a, b) => b.date.localeCompare(a.date))[0]?.date
              ? shortDate(
                  data.attendance
                    .filter((a) => a.memberId === selectedMember.id)
                    .sort((a, b) => b.date.localeCompare(a.date))[0].date,
                )
              : 'Not yet'}
          </p>
          <p className="ops-context-note">
            To enable online coaching, invite this member’s email from Coaching clients. Their
            studio membership and coaching account are managed separately.
          </p>
        </Modal>
      )}
      {editor && (
        <Modal
          title={editorTitle}
          onClose={() => {
            if (!busy) {
              setEditor(null);
              setError('');
            }
          }}
        >
          {editor.kind === 'receipt' && receipt ? (
            <Receipt payment={receipt} data={data} />
          ) : (
            <form
              className="form-stack ops-editor"
              onSubmit={submit}
              key={`${editor.kind}-${editor.id || 'new'}`}
            >
              {editor.kind === 'member' && (
                <>
                  <div className="ops-form-note">
                    <Users size={18} />
                    <p>
                      Create a member record, then assign a membership. A coaching account can be
                      invited separately.
                    </p>
                  </div>
                  <Field label="Full name">
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={160}
                      defaultValue={editMember?.name || editor.name}
                    />
                  </Field>
                  <div className="ops-form-grid">
                    <Field label="Email (optional)">
                      <input
                        name="email"
                        type="email"
                        maxLength={254}
                        defaultValue={editMember?.email}
                      />
                    </Field>
                    <Field label="Phone (optional)">
                      <input
                        name="phone"
                        type="tel"
                        maxLength={30}
                        defaultValue={editMember?.phone || editor.phone}
                      />
                    </Field>
                  </div>
                  <Field label="Training goal">
                    <input
                      name="goal"
                      maxLength={160}
                      placeholder="e.g. Build strength and consistency"
                      defaultValue={editMember?.goal}
                    />
                  </Field>
                  <div className="ops-form-grid">
                    <Field label="Joined on">
                      <input
                        name="joinedOn"
                        type="date"
                        required
                        defaultValue={editMember?.joinedOn || today}
                      />
                    </Field>
                    <Field label="Member status">
                      <select name="status" defaultValue={editMember?.status || 'active'}>
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="archived">Archived</option>
                      </select>
                    </Field>
                  </div>
                </>
              )}
              {editor.kind === 'offer' && (
                <>
                  <Field label="Plan name">
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={160}
                      defaultValue={editOffer?.name}
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      name="description"
                      maxLength={400}
                      defaultValue={editOffer?.description}
                    />
                  </Field>
                  <div className="ops-form-grid">
                    <Field label="Duration (days)">
                      <input
                        name="durationDays"
                        type="number"
                        required
                        min={1}
                        max={730}
                        defaultValue={editOffer?.durationDays || 30}
                      />
                    </Field>
                    <Field label="Price (INR)">
                      <input
                        name="price"
                        type="number"
                        required
                        min={0}
                        max={1000000}
                        step="0.01"
                        defaultValue={editOffer ? editOffer.pricePaise / 100 : 2500}
                      />
                    </Field>
                  </div>
                  <Field label="Availability">
                    <select name="active" defaultValue={String(editOffer?.active ?? true)}>
                      <option value="true">Available for new memberships</option>
                      <option value="false">Hidden from new assignments</option>
                    </select>
                  </Field>
                  <p className="ops-context-note">
                    Changes apply to new memberships. Existing terms retain their agreed price and
                    dates.
                  </p>
                </>
              )}
              {editor.kind === 'term' && (
                <>
                  <Field label="Member">
                    <select name="memberId" required defaultValue={editor.memberId || ''}>
                      <option value="" disabled>
                        Select a member
                      </option>
                      {data.members
                        .filter((m) => m.status === 'active')
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Membership plan">
                    <select name="offerId" required defaultValue="">
                      <option value="" disabled>
                        Select a plan
                      </option>
                      {data.offers
                        .filter((p) => p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {money(p.pricePaise)} / {p.durationDays} days
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Membership starts on">
                    <input
                      name="startsOn"
                      type="date"
                      required
                      defaultValue={
                        editor.memberId
                          ? data.terms
                              .filter(
                                (t) => t.memberId === editor.memberId && t.status !== 'cancelled',
                              )
                              .reduce(
                                (latest, t) => (t.endsOn >= latest ? addDays(t.endsOn, 1) : latest),
                                today,
                              )
                          : today
                      }
                    />
                  </Field>
                  <p className="ops-context-note">
                    The end date is calculated from the plan duration, including the first day.
                    Existing terms cannot overlap. Record payment separately after assignment.
                  </p>
                  {(!data.members.some((m) => m.status === 'active') ||
                    !data.offers.some((p) => p.active)) && (
                    <p className="inline-notice">
                      Add an active member and an available plan first.
                    </p>
                  )}
                </>
              )}
              {editor.kind === 'payment' && (
                <>
                  <Field label="Membership to pay">
                    <select name="termId" required defaultValue={editor.id || ''}>
                      <option value="" disabled>
                        Select an outstanding membership
                      </option>
                      {data.terms
                        .filter(
                          (t) =>
                            t.status !== 'cancelled' &&
                            outstanding(t, data.payments) > 0 &&
                            (!editor.memberId || t.memberId === editor.memberId),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {memberName(t.memberId)} · {t.planName} ·{' '}
                            {money(outstanding(t, data.payments))} due
                          </option>
                        ))}
                    </select>
                  </Field>
                  <div className="ops-form-grid">
                    <Field label="Amount received (INR)">
                      <input
                        name="amount"
                        type="number"
                        required
                        min="0.01"
                        max={1000000}
                        step="0.01"
                        defaultValue={
                          editor.id
                            ? outstanding(termById.get(editor.id)!, data.payments) / 100
                            : undefined
                        }
                      />
                    </Field>
                    <Field label="Payment date">
                      <input name="paidOn" type="date" required defaultValue={today} max={today} />
                    </Field>
                  </div>
                  <Field label="Payment method">
                    <select name="method">
                      <option>UPI</option>
                      <option>Cash</option>
                      <option>Card</option>
                      <option>Bank transfer</option>
                    </select>
                  </Field>
                  <Field label="Transaction reference / note">
                    <input
                      name="reference"
                      maxLength={160}
                      placeholder="e.g. UPI reference number"
                    />
                  </Field>
                  <p className="ops-context-note">
                    Confirm the money was received before recording. This saves a receipt in the
                    studio ledger; it does not process a charge.
                  </p>
                </>
              )}
              {editor.kind === 'enquiry' && (
                <>
                  <Field label="Name">
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={160}
                      defaultValue={editEnquiry?.name}
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      name="phone"
                      type="tel"
                      required
                      minLength={3}
                      maxLength={30}
                      defaultValue={editEnquiry?.phone}
                    />
                  </Field>
                  <Field label="Interested in">
                    <input
                      name="interest"
                      required
                      minLength={2}
                      maxLength={160}
                      defaultValue={editEnquiry?.interest}
                      placeholder="e.g. Personal training"
                    />
                  </Field>
                  <div className="ops-form-grid">
                    <Field label="Source">
                      <select name="source" defaultValue={editEnquiry?.source || 'Walk-in'}>
                        {['Walk-in', 'Referral', 'Instagram', 'Website', 'Other'].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Stage">
                      <select name="stage" defaultValue={editEnquiry?.stage || 'new'}>
                        {['new', 'contacted', 'trial', 'won', 'lost'].map((s) => (
                          <option key={s} value={s}>
                            {
                              {
                                new: 'New',
                                contacted: 'Contacted',
                                trial: 'Trial planned',
                                won: 'Joined',
                                lost: 'Closed',
                              }[s]
                            }
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Follow-up date">
                    <input
                      name="followUpOn"
                      required
                      type="date"
                      defaultValue={editEnquiry?.followUpOn || today}
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea name="note" maxLength={1000} defaultValue={editEnquiry?.note} />
                  </Field>
                  {editEnquiry?.stage === 'won' && (
                    <button
                      type="button"
                      className="button outline"
                      onClick={() =>
                        open({ kind: 'member', name: editEnquiry.name, phone: editEnquiry.phone })
                      }
                    >
                      Create their member record
                      <ArrowRight size={15} />
                    </button>
                  )}
                </>
              )}
              {editor.kind === 'staff' && (
                <>
                  <Field label="Full name">
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={160}
                      defaultValue={editStaff?.name}
                    />
                  </Field>
                  <div className="ops-form-grid">
                    <Field label="Email">
                      <input
                        name="email"
                        type="email"
                        maxLength={254}
                        defaultValue={editStaff?.email}
                      />
                    </Field>
                    <Field label="Phone">
                      <input
                        name="phone"
                        type="tel"
                        maxLength={30}
                        defaultValue={editStaff?.phone}
                      />
                    </Field>
                  </div>
                  <Field label="Role">
                    <input
                      name="role"
                      required
                      minLength={2}
                      maxLength={160}
                      defaultValue={editStaff?.role}
                      placeholder="e.g. Head coach"
                    />
                  </Field>
                  <Field label="Specialty">
                    <input name="specialty" maxLength={160} defaultValue={editStaff?.specialty} />
                  </Field>
                  <Field label="Status">
                    <select name="status" defaultValue={editStaff?.status || 'active'}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </Field>
                </>
              )}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="button outline"
                  disabled={busy}
                  onClick={() => {
                    setEditor(null);
                    setError('');
                  }}
                >
                  Cancel
                </button>
                <button className="button dark" disabled={busy}>
                  {busy
                    ? 'Saving…'
                    : editor.kind === 'payment'
                      ? 'Confirm payment received'
                      : editor.kind === 'term'
                        ? 'Assign membership'
                        : 'Save changes'}
                  <Check size={16} />
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}

function Receipt({ payment, data }: { payment: StudioPayment; data: OperationsData }) {
  const term = data.terms.find((t) => t.id === payment.termId);
  const member = data.members.find((m) => m.id === term?.memberId);
  return (
    <div className="ops-receipt">
      <div className="ops-receipt-brand">
        <span className="ops-eyebrow">GEEZ SQUAD</span>
        <h2>{data.studio.name}</h2>
        <p>{data.studio.address}</p>
      </div>
      <Badge tone="green">Payment received</Badge>
      <div className="ops-receipt-amount">{money(payment.amountPaise)}</div>
      <dl>
        <div>
          <dt>Received from</dt>
          <dd>{member?.name}</dd>
        </div>
        <div>
          <dt>Membership</dt>
          <dd>{term?.planName}</dd>
        </div>
        <div>
          <dt>Paid on</dt>
          <dd>{shortDate(payment.paidOn)}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{payment.method}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{payment.reference || '—'}</dd>
        </div>
        <div>
          <dt>Receipt ID</dt>
          <dd>{payment.id}</dd>
        </div>
      </dl>
      <p>Thank you for being part of the squad. This is a payment acknowledgement.</p>
      <button className="button dark full ops-no-print" onClick={() => window.print()}>
        <Printer size={16} />
        Print receipt
      </button>
    </div>
  );
}
