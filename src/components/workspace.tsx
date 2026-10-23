'use client';
import { isHoldExercise } from '@/lib/exercise-profiles';
import { useState, useEffect, useRef, useId } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Dumbbell,
  ChartNoAxesCombined,
  Settings2,
  Search,
  Bell,
  ChevronDown,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Video,
  Clock3,
  Activity,
  Check,
  LogOut,
  CircleHelp,
  X,
  Copy,
  CheckCircle2,
  Play,
  SlidersHorizontal,
  Menu,
  ScanLine,
  Download,
  ShieldCheck,
  Pencil,
  Trash2,
  CreditCard,
  CalendarCheck,
  Wallet,
  ContactRound,
  Building2,
  UserRoundCog,
} from 'lucide-react';
import {
  Brand,
  Avatar,
  MotionArt,
  ExerciseArt,
  EmptyState,
  Modal,
  SectionTitle,
  TextAction,
} from './ui';
import { exercises, starterBlocks, exerciseName } from '@/lib/catalog';
import type { WorkspaceData, ClassView, Block, ClientView, Plan } from '@/lib/types';
import { apiCommand, fetchJson } from '@/lib/client';
import { authClient } from '@/lib/auth-client';
import { useTimeFormat } from './time-provider';
import { TrainingProgress, CheckInForm, ClientCoaching } from './training-progress';
import { ScheduleForm } from './session-form';
import { ClientManagement } from './client-management';
import { CoachingFollowUps } from './coaching-follow-ups';
import { coachingOverview } from '@/lib/coaching-insights';
import { compareSessions } from '@/lib/session-timing';
import { StudioOperations } from './studio-operations';
import { StudioJoinRequests } from './studio-join-requests';
import { InPersonTrainees } from './in-person-trainees';
import { HostedClasses } from './hosted-classes';
import { MyBookings } from './my-bookings';
import { MemberMembership } from './member-membership';
const Studio = dynamic(() => import('./studio').then((m) => m.Studio), {
  ssr: false,
  loading: () => <div className="page-loading">Opening your studio…</div>,
});
const nav = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
  { id: 'members', name: 'Members', icon: Users },
  { id: 'memberships', name: 'Memberships', icon: CreditCard },
  { id: 'attendance', name: 'Attendance', icon: CalendarCheck },
  { id: 'payments', name: 'Payments', icon: Wallet },
  { id: 'enquiries', name: 'Enquiries', icon: ContactRound },
  { id: 'staff', name: 'Team', icon: UserRoundCog },
  { id: 'classes', name: 'Studio classes', icon: CalendarDays },
  { id: 'sessions', name: 'Live sessions', icon: Video },
  { id: 'coaching', name: 'Coaching overview', icon: Activity },
  { id: 'clients', name: 'Coaching clients', icon: Users },
  { id: 'plans', name: 'Workout plans', icon: Dumbbell },
  { id: 'analytics', name: 'Insights', icon: ChartNoAxesCombined },
  { id: 'studio-details', name: 'Studio details', icon: Building2 },
];
type Command = Record<string, unknown>;
export function Workspace({ initial, view }: { initial: WorkspaceData; view: string }) {
  const { dateLabel, timeLabel, timeZone } = useTimeFormat();
  const searchInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const navigationId = useId();
  const [smallScreen, setSmallScreen] = useState(false);
  const mutationVersion = useRef(0);
  const pendingMutations = useRef(0);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  const router = useRouter(),
    [data, setData] = useState(initial),
    [search, setSearch] = useState(''),
    [modal, setModal] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(''),
    [syncWarning, setSyncWarning] = useState(''),
    [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setSmallScreen(media.matches);
      if (!media.matches) setMobileMenu(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileMenu || !smallScreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [],
      ).filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenu(false);
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', handle);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handle);
      menuTrigger.current?.focus();
    };
  }, [mobileMenu, smallScreen]);
  useEffect(() => {
    if (initial.demo) return;
    let active = true;
    let fetching = false;
    const controller = new AbortController();
    async function update() {
      if (fetching || pendingMutations.current || document.hidden) return;
      fetching = true;
      const version = mutationVersion.current;
      try {
        const fresh = await fetchJson<WorkspaceData>('/api/workspace', {
          signal: controller.signal,
        });
        if (active && version === mutationVersion.current) {
          setData(fresh);
          setSyncWarning('');
        }
      } catch {
        if (active) setSyncWarning('Studio updates are delayed. We’ll reconnect automatically.');
      } finally {
        fetching = false;
      }
    }
    void update();
    const interval = setInterval(() => void update(), 30000);
    const onFocus = () => void update();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [initial.demo, view]);
  const [selectedClient, setSelectedClient] = useState<ClientView | null>(null),
    [followUpOnly, setFollowUpOnly] = useState(false),
    [selectedSession, setSelectedSession] = useState<ClassView | null>(null),
    [selectedPlan, setSelectedPlan] = useState<Plan | null>(null),
    [activeClass, setActiveClass] = useState<ClassView | null>(null),
    [inviteResult, setInviteResult] = useState(''),
    [filter, setFilter] = useState('upcoming'),
    [progressClient, setProgressClient] = useState('all');
  const base = data.demo ? '/demo' : '/app',
    coach = data.permissions?.coach ?? data.user.role === 'coach',
    admin = data.permissions?.admin ?? (data.demo && coach);
  const allowedViews = admin
    ? nav.map((n) => n.id)
    : coach
      ? ['coaching', 'clients', 'sessions', 'classes', 'plans', 'analytics']
      : ['dashboard', 'sessions', 'plans', 'analytics'];
  const currentClient = data.clients.find((person) => person.id === selectedClient?.id);
  const overview = coachingOverview(data, timeZone);
  const activeView =
    [
      'dashboard',
      'clients',
      'sessions',
      'plans',
      'analytics',
      'settings',
      'studio',
      'practice',
      'setup',
      'members',
      'memberships',
      'attendance',
      'payments',
      'enquiries',
      'staff',
      'studio-details',
      'coaching',
      'classes',
      'benefits',
    ].includes(view) &&
    (allowedViews.includes(view) ||
      ['settings', 'studio', 'practice', 'setup', 'benefits'].includes(view))
      ? view
      : coach && !admin
        ? 'coaching'
        : 'dashboard';
  const upcoming = data.classes
    .filter((c) => c.status === 'scheduled' || c.status === 'live')
    .sort(compareSessions);
  const history = data.classes
    .filter((c) => c.status === 'completed' && +new Date(c.startsAt) >= Date.now() - 30 * 86400000)
    .sort(compareSessions);
  function go(next: string) {
    if (next === 'analytics') setProgressClient('all');
    setMobileMenu(false);
    setSearch('');
    router.push(`${base}?view=${next}`);
  }
  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 5000);
  }
  function show(name: string) {
    if (name === 'schedule') setSelectedSession(null);
    setMobileMenu(false);
    setError('');
    setInviteResult('');
    setModal(name);
  }
  function editSession(session: ClassView) {
    show('schedule');
    setSelectedSession(session);
  }
  async function refresh() {
    if (!data.demo) setData(await fetchJson<WorkspaceData>('/api/workspace'));
  }
  async function command(payload: Command): Promise<Record<string, unknown>> {
    mutationVersion.current++;
    pendingMutations.current++;
    setBusy(true);
    setError('');
    try {
      if (!data.demo) {
        const result = await apiCommand(payload);
        await refresh();
        return result;
      }
      const id = `sample-${crypto.randomUUID()}`;
      if (payload.action === 'invite')
        return { url: 'Sample preview — create an account to generate a real invitation.' };
      setData((current) => {
        if (payload.action === 'clientProfile')
          return {
            ...current,
            clients: current.clients.map((person) =>
              person.id === payload.userId
                ? { ...person, name: payload.name as string, goal: payload.goal as string }
                : person,
            ),
            classes: current.classes.map((item) => ({
              ...item,
              participants: item.participants.map((person) =>
                person.id === payload.userId ? { ...person, name: payload.name as string } : person,
              ),
            })),
          };
        if (payload.action === 'removeClient')
          return {
            ...current,
            clients: current.clients.filter((person) => person.id !== payload.userId),
            assignments: current.assignments.filter((item) => item.userId !== payload.userId),
            classes: current.classes.map((item) =>
              item.status === 'scheduled'
                ? {
                    ...item,
                    participants: item.participants.filter(
                      (person) => person.id !== payload.userId,
                    ),
                  }
                : item,
            ),
            workoutSets: current.workoutSets.filter((set) => set.userId !== payload.userId),
            checkIns: current.checkIns.filter((entry) => entry.userId !== payload.userId),
          };
        if (payload.action === 'updateClass')
          return {
            ...current,
            classes: current.classes.map((item) =>
              item.id === payload.id
                ? {
                    ...item,
                    title: payload.title as string,
                    startsAt: payload.startsAt as string,
                    duration: payload.duration as number,
                    capacity: payload.capacity as number,
                    planId: payload.planId as string | null,
                    revision: item.revision + 1,
                    participants: current.clients
                      .filter(
                        (person) =>
                          payload.includeAllClients ||
                          (payload.participantIds as string[]).includes(person.id),
                      )
                      .map(
                        (person) =>
                          item.participants.find((p) => p.id === person.id) ?? {
                            id: person.id,
                            name: person.name,
                            helpRequested: false,
                            metric: null,
                            summary: null,
                          },
                      ),
                  }
                : item,
            ),
          };
        if (payload.action === 'savePlan') {
          const plan = {
            id: (payload.id as string) || id,
            name: payload.name as string,
            description: payload.description as string,
            blocks: payload.blocks as Block[],
          };
          return {
            ...current,
            plans: payload.id
              ? current.plans.map((p) => (p.id === payload.id ? plan : p))
              : [plan, ...current.plans],
          };
        }
        if (payload.action === 'deletePlan')
          return { ...current, plans: current.plans.filter((p) => p.id !== payload.id) };
        if (payload.action === 'assignPlan') {
          const remaining = current.assignments.filter((a) => a.userId !== payload.userId);
          const plan = current.plans.find((p) => p.id === payload.planId);
          return {
            ...current,
            assignments: plan
              ? [
                  ...remaining,
                  {
                    userId: payload.userId as string,
                    planId: plan.id,
                    planName: plan.name,
                    assignedAt: new Date().toISOString(),
                  },
                ]
              : remaining,
          };
        }
        if (payload.action === 'coachNote')
          return {
            ...current,
            clients: current.clients.map((c) =>
              c.id === payload.userId ? { ...c, coachNote: payload.note as string } : c,
            ),
          };
        if (payload.action === 'checkIn')
          return {
            ...current,
            checkIns: [
              {
                id,
                userId: current.user.id,
                userName: current.user.name,
                energy: payload.energy as number,
                soreness: payload.soreness as number,
                effort: payload.effort as number | null,
                sleepHours: payload.sleepHours as number | null,
                bodyweightKg: payload.bodyweightKg as number | null,
                note: payload.note as string,
                createdAt: new Date().toISOString(),
              },
              ...current.checkIns,
            ],
          };
        if (payload.action === 'profile')
          return {
            ...current,
            user: { ...current.user, name: payload.name as string, goal: payload.goal as string },
          };
        if (payload.action === 'createClass') {
          const item: ClassView = {
            id,
            title: payload.title as string,
            startsAt: payload.startsAt as string,
            duration: payload.duration as number,
            capacity: payload.capacity as number,
            planId: (payload.planId as string) || null,
            status: 'scheduled',
            exercise: 'squat',
            revision: 0,
            paused: false,
            coachId: current.user.id,
            coachName: current.user.name,
            startedAt: null,
            endedAt: null,
            participants: current.clients
              .filter(
                (c) =>
                  payload.includeAllClients || (payload.participantIds as string[]).includes(c.id),
              )
              .map((c) => ({
                id: c.id,
                name: c.name,
                helpRequested: false,
                metric: null,
                summary: null,
              })),
          };
          return { ...current, classes: [item, ...current.classes] };
        }
        if (payload.action === 'classControl')
          return {
            ...current,
            classes: current.classes.map((c) =>
              c.id === payload.id
                ? {
                    ...c,
                    status:
                      payload.control === 'start'
                        ? 'live'
                        : payload.control === 'end'
                          ? 'completed'
                          : payload.control === 'cancel'
                            ? 'cancelled'
                            : c.status,
                    paused:
                      payload.control === 'pause'
                        ? true
                        : payload.control === 'resume'
                          ? false
                          : c.paused,
                    exercise: (payload.exercise as ClassView['exercise']) || c.exercise,
                    revision: c.revision + 1,
                    startedAt: payload.control === 'start' ? new Date().toISOString() : c.startedAt,
                    endedAt: payload.control === 'end' ? new Date().toISOString() : c.endedAt,
                  }
                : c,
            ),
          };
        return current;
      });
      return { ok: true, id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Please retry.';
      setError(message);
      throw err;
    } finally {
      mutationVersion.current++;
      pendingMutations.current--;
      setBusy(false);
    }
  }
  async function openClass(c: ClassView) {
    if (data.demo) {
      setActiveClass({ ...c, status: 'live', startedAt: new Date().toISOString() });
      go('studio');
      return;
    }
    window.location.href = `/studio/${c.id}`;
  }
  const searchClients = data.clients.filter(
    (c) =>
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.email.includes(search.toLowerCase())) &&
      (activeView !== 'clients' ||
        !followUpOnly ||
        overview.followUps.some((item) => item.person.id === c.id)),
  );
  const searchPlans = data.plans.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="app-layout">
      {smallScreen && mobileMenu && (
        <button
          className="navigation-backdrop"
          aria-label="Dismiss navigation"
          onClick={() => setMobileMenu(false)}
          tabIndex={-1}
        />
      )}
      <aside
        ref={sidebar}
        id={navigationId}
        className={`sidebar ${mobileMenu ? 'open' : ''}`}
        inert={smallScreen && !mobileMenu}
        role={smallScreen && mobileMenu ? 'dialog' : undefined}
        aria-modal={smallScreen && mobileMenu ? true : undefined}
        aria-label="Workspace navigation"
      >
        <button
          className="icon-button navigation-close"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        >
          <X size={22} />
        </button>
        <Link href={base} className="brand-link">
          <Brand />
        </Link>
        <button className="studio-selector" onClick={() => show('studioInfo')}>
          <span className="studio-monogram">{data.studio?.name[0] || 'Y'}</span>
          <span>
            <strong>{data.studio?.name || 'Your studio'}</strong>
            <small>
              {data.demo
                ? 'Sample studio'
                : admin
                  ? 'Studio management'
                  : coach
                    ? 'Coaching workspace'
                    : 'Member workspace'}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        {!data.demo && (
          <button className="text-action" onClick={() => go('benefits')}>
            My membership &amp; classes
          </button>
        )}
        <span className="nav-label">{coach ? 'YOUR STUDIO' : 'YOUR TRAINING'}</span>
        <nav>
          {nav
            .filter((n) => allowedViews.includes(n.id))
            .map((n) => (
              <Link
                key={n.id}
                href={`${base}?view=${n.id}`}
                className={`nav-item ${activeView === n.id ? 'active' : ''}`}
                aria-current={activeView === n.id ? 'page' : undefined}
                onClick={() => {
                  setMobileMenu(false);
                  setSearch('');
                }}
              >
                <n.icon size={19} />
                <span>{n.name}</span>
                {n.id === 'clients' && <small>{data.clients.length}</small>}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="coach-note">
            <span className="note-orbit">✳</span>
            <strong>
              A human touch.
              <br />A smarter way to train.
            </strong>
            <p>Every rep is a chance to move a little better.</p>
            <button onClick={() => go('practice')}>
              Try camera coaching
              <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => go('settings')}
          >
            <Settings2 size={18} /> Settings
          </button>
          <button className="nav-item" onClick={() => show('help')}>
            <CircleHelp size={18} /> Help & resources
            <ArrowUpRight size={14} />
          </button>
          <button className="profile-button" onClick={() => go('settings')}>
            <Avatar name={data.user.name} small />
            <span>
              <strong>{data.user.name}</strong>
              <small>{admin ? 'Admin' : coach ? 'Coach' : 'Trainee'}</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell" inert={smallScreen && mobileMenu}>
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            ref={menuTrigger}
            aria-label="Open navigation"
            aria-expanded={mobileMenu}
            aria-controls={navigationId}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            {coach ? 'Geez Squad studio' : 'Your workspace'}
            <span>/</span>
            <strong>
              {activeView === 'studio'
                ? 'Live studio'
                : activeView === 'practice'
                  ? 'Camera coaching'
                  : nav.find((n) => n.id === activeView)?.name || 'Settings'}
            </strong>
          </div>
          <div className="top-actions">
            <div className="search-wrap">
              <Search size={17} />
              <input
                ref={searchInput}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your workspace…"
                aria-label="Search your workspace"
              />
              <kbd>⌘ K</kbd>
            </div>
            <button
              className="icon-button notification-button"
              aria-label="Upcoming session notifications"
              onClick={() => show('notifications')}
            >
              <Bell size={19} />
              {upcoming.length > 0 && <i />}
            </button>
            <Avatar name={data.user.name} small />
          </div>
        </header>
        {data.demo && (
          <div className="demo-banner">
            <span>
              <span className="status-dot" /> Sample studio · All client data and history are
              illustrative. Changes reset on refresh.
            </span>
            <Link href="/login">
              Make it yours
              <ArrowUpRight size={14} />
            </Link>
          </div>
        )}
        <main className={`workspace-content ${activeView === 'studio' ? 'studio-content' : ''}`}>
          {!data.demo && (
            <>
              <StudioJoinRequests />
              <StudioJoinRequests kind="coach" />
            </>
          )}
          {syncWarning && (
            <p className="inline-notice" role="status">
              {syncWarning}
            </p>
          )}
          {search &&
            ![
              'clients',
              'plans',
              'dashboard',
              'members',
              'memberships',
              'attendance',
              'payments',
              'enquiries',
              'staff',
              'studio-details',
              'classes',
            ].includes(activeView) && (
              <div className="search-results panel">
                <SectionTitle
                  title={`Results for “${search}”`}
                  action={
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setSearch('')}
                    >
                      <X size={16} />
                    </button>
                  }
                />
                {searchClients.slice(0, 4).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedClient(c);
                      show('client');
                    }}
                  >
                    <Avatar name={c.name} small />
                    {c.name}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
                {searchPlans.slice(0, 4).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedPlan(p);
                      show('plan');
                    }}
                  >
                    <Dumbbell size={17} />
                    {p.name}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
                {!searchClients.length && !searchPlans.length && (
                  <p>No clients or plans match your search.</p>
                )}
              </div>
            )}
          {admin && data.studio && (
            <StudioOperations
              view={activeView}
              workspace={data}
              search={search}
              onNavigate={go}
              onSchedule={() => show('schedule')}
            />
          )}
          {coach && !admin && activeView === 'classes' && <HostedClasses />}
          {activeView === 'benefits' && !data.demo && (
            <>
              <MemberMembership />
              <MyBookings />
            </>
          )}
          {(activeView === 'coaching' || (activeView === 'dashboard' && !coach)) && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">LET’S MAKE MOVEMENT MATTER</span>
                  <h1>
                    {coach ? 'A good day to make progress.' : 'Your next chapter starts here.'}
                    <span className="greeting-spark">✳</span>
                  </h1>
                  <p>
                    {coach
                      ? `Welcome back, ${data.user.name.split(' ')[0]}. A little guidance. A lot of possibility.`
                      : `Welcome, ${data.user.name.split(' ')[0]}. Show up for yourself, one session at a time.`}
                  </p>
                </div>
                <button
                  className="button dark"
                  onClick={() => (coach ? show('schedule') : go('practice'))}
                >
                  {coach ? <Plus size={17} /> : <ScanLine size={17} />}{' '}
                  {coach ? 'Schedule session' : 'Camera practice'}
                </button>
              </div>
              {!coach && !data.demo && (
                <>
                  <MemberMembership />
                  <MyBookings />
                </>
              )}
              {!coach && (
                <section className="panel trainee-coaching-overview">
                  <div>
                    <h2>Ready for your next workout?</h2>
                    <p>
                      {data.assignments[0]
                        ? `Your coach assigned ${data.plans.find((p) => p.id === data.assignments[0].planId)?.name ?? 'a workout plan'}. Open practice to train through its exercises.`
                        : 'Share your energy and recovery with your coach before training.'}
                    </p>
                  </div>
                  <div className="form-actions">
                    <button className="button outline" onClick={() => show('checkIn')}>
                      Share a check-in
                    </button>
                    {!!data.assignments.length && (
                      <button className="button dark" onClick={() => go('practice')}>
                        Train assigned plan
                      </button>
                    )}
                  </div>
                </section>
              )}
              <div className="stats-grid">
                {overview.cards.map((card, index) => (
                  <Stat
                    key={card.label}
                    {...card}
                    icon={
                      index === 0 ? (
                        <Users size={19} />
                      ) : index === 1 ? (
                        <CalendarDays size={19} />
                      ) : index === 2 ? (
                        <CheckCircle2 size={19} />
                      ) : (
                        <Activity size={19} />
                      )
                    }
                    color={['lime', 'lavender', 'peach', 'sky'][index]}
                  />
                ))}
              </div>
              <div className="dashboard-middle">
                <section className="session-hero">
                  <div className="hero-copy">
                    <span className="hero-kicker">
                      <span className="status-dot" />
                      {upcoming[0]?.status === 'live' ? 'LIVE NOW' : 'NEXT IN YOUR STUDIO'}
                    </span>
                    <h2>{upcoming[0]?.title || 'Good movement starts with connection.'}</h2>
                    <p>
                      {upcoming[0]
                        ? `${dateLabel(upcoming[0].startsAt)} · ${timeLabel(upcoming[0].startsAt)} · ${upcoming[0].duration} min`
                        : coach
                          ? 'Bring your clients together for a session that moves them forward.'
                          : 'Your coach’s sessions will appear here. Practice locally while you wait.'}
                    </p>
                    {upcoming[0] && (
                      <div className="avatar-stack">
                        {upcoming[0].participants.slice(0, 4).map((p, i) => (
                          <Avatar key={p.id} name={p.name} index={i} small />
                        ))}
                        <span>
                          {upcoming[0].participants.length}{' '}
                          {coach ? 'clients joining' : 'your enrollment'}
                        </span>
                      </div>
                    )}
                    <button
                      className="button dark"
                      onClick={() =>
                        upcoming[0]
                          ? void openClass(upcoming[0])
                          : coach
                            ? show('schedule')
                            : go('sessions')
                      }
                    >
                      {upcoming[0]
                        ? 'Open studio'
                        : coach
                          ? 'Create your first session'
                          : 'View sessions'}
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <MotionArt />
                  <span className="hero-decoration">MOVE BETTER. TOGETHER.</span>
                </section>
                <CoachingFollowUps
                  data={data}
                  onClient={(person) => {
                    setSelectedClient(person);
                    show('client');
                  }}
                  onCheckIn={() => show('checkIn')}
                  onReviewAll={() => {
                    go('clients');
                    setFollowUpOnly(true);
                  }}
                />
              </div>
              <div className="dashboard-bottom">
                <section className="panel">
                  <SectionTitle
                    title={coach ? 'Your people, your impact' : 'Recent sessions'}
                    action={
                      <TextAction onClick={() => go(coach ? 'clients' : 'analytics')}>
                        View all
                      </TextAction>
                    }
                  />
                  {coach ? (
                    data.clients.length ? (
                      <div className="client-table">
                        <div className="table-head">
                          <span>CLIENT</span>
                          <span>ASSIGNED PLAN</span>
                          <span>LAST CHECK-IN</span>
                          <span />
                        </div>
                        {data.clients.slice(0, 4).map((c, i) => {
                          const insight = overview.trainees.find(
                            (item) => item.person.id === c.id,
                          )!;
                          return (
                            <button
                              className="client-row"
                              key={c.id}
                              onClick={() => {
                                setSelectedClient(c);
                                show('client');
                              }}
                            >
                              <span className="person-cell">
                                <Avatar name={c.name} index={i} small />
                                <span>
                                  <strong>{c.name}</strong>
                                  <small>{c.goal}</small>
                                </span>
                              </span>
                              <span>{insight.plan?.name ?? 'No assigned plan'}</span>
                              <span>
                                {insight.checkIn
                                  ? dateLabel(insight.checkIn.createdAt)
                                  : 'No check-in'}
                              </span>
                              <ArrowUpRight size={16} />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState
                        title="Build your circle."
                        text={
                          admin
                            ? 'Add your first member and assign their membership.'
                            : 'An admin can assign trainees to you from Team. You can still prepare plans and host appointed classes.'
                        }
                        action={
                          admin ? (
                            <button className="button lime" onClick={() => go('members')}>
                              Add a member
                            </button>
                          ) : undefined
                        }
                      />
                    )
                  ) : (
                    <SessionRows classes={history.slice(0, 3)} onOpen={openClass} />
                  )}
                </section>
                <section className="panel plan-spotlight">
                  <SectionTitle
                    title="Built for better movement"
                    action={<TextAction onClick={() => go('plans')}>Plans</TextAction>}
                  />
                  <div className="spotlight-art lavender">
                    <ExerciseArt exercise="pushup" />
                    <span className="pill">WORKOUT LIBRARY</span>
                  </div>
                  <h3>{data.plans[0]?.name || 'Your next plan'}</h3>
                  <p>
                    {data.plans[0]?.description ||
                      'Create intentional sessions with clear sets, reps, and recovery.'}
                  </p>
                  <button
                    className="text-link"
                    onClick={() => {
                      if (data.plans[0]) {
                        setSelectedPlan(data.plans[0]);
                        show('plan');
                      } else if (coach) {
                        setSelectedPlan(null);
                        show('plan');
                      } else go('plans');
                    }}
                  >
                    {data.plans[0]
                      ? `${data.plans[0].blocks.length} exercises · View plan`
                      : coach
                        ? 'Create a plan'
                        : 'Explore the movement library'}
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>
            </>
          )}
          {coach && !data.demo && activeView === 'clients' && <InPersonTrainees />}
          {activeView === 'clients' && (
            <>
              <PageHeading
                eyebrow="GROW TOGETHER"
                title="People make the progress."
                text="A clear view of every person you coach."
                action={
                  admin ? (
                    <button className="button dark" onClick={() => go('members')}>
                      <Plus size={17} /> Add member
                    </button>
                  ) : undefined
                }
              />
              <div className="list-toolbar">
                <span>{searchClients.length} clients in your studio</span>
                <span className="pill">
                  <Users size={14} /> Active members
                </span>
                <label className="follow-up-filter">
                  <input
                    type="checkbox"
                    checked={followUpOnly}
                    onChange={(event) => setFollowUpOnly(event.target.checked)}
                  />{' '}
                  Follow-ups only
                </label>
              </div>
              <div className="client-card-grid">
                {searchClients.map((c, i) => (
                  <button
                    className="panel client-card"
                    key={c.id}
                    onClick={() => {
                      setSelectedClient(c);
                      show('client');
                    }}
                  >
                    <div>
                      <Avatar name={c.name} index={i} />
                      <ArrowUpRight size={18} />
                    </div>
                    <h3>{c.name}</h3>
                    <p>{c.email}</p>
                    <span className="goal-pill">{c.goal}</span>
                    <p className="client-action-summary">
                      {overview.trainees
                        .find((item) => item.person.id === c.id)
                        ?.reasons.join(' · ') || 'No current follow-ups'}
                    </p>
                    <footer>
                      <span>
                        {overview.trainees.find((item) => item.person.id === c.id)
                          ?.completedSetsThisWeek ?? 0}{' '}
                        completed sets in 7 days
                      </span>
                    </footer>
                  </button>
                ))}
              </div>
              {!searchClients.length && (
                <EmptyState
                  title={
                    search || followUpOnly ? 'No matching clients.' : 'Your people will be here.'
                  }
                  text={
                    search || followUpOnly
                      ? 'Try another name or email, or turn off the follow-up filter.'
                      : admin
                        ? 'Add a member and connect their account to start coaching together.'
                        : 'An admin can connect and assign trainees to you from Team.'
                  }
                  action={
                    admin ? (
                      <button className="button lime" onClick={() => go('members')}>
                        Add member
                      </button>
                    ) : undefined
                  }
                />
              )}
            </>
          )}
          {activeView === 'sessions' && (
            <>
              <PageHeading
                eyebrow="A LITTLE STRUCTURE. A LOT OF PROGRESS."
                title="Make time for movement."
                text="Your coaching calendar, all in one place."
                action={
                  coach ? (
                    <button className="button dark" onClick={() => show('schedule')}>
                      <Plus size={17} /> Schedule session
                    </button>
                  ) : undefined
                }
              />
              <div className="list-toolbar">
                <div className="segmented">
                  {['upcoming', 'completed', 'cancelled'].map((f) => (
                    <button
                      key={f}
                      className={filter === f ? 'selected' : ''}
                      onClick={() => setFilter(f)}
                    >
                      {f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                <span className="subtle">
                  <CalendarDays size={16} />
                  {timeZone}
                </span>
              </div>
              <div className="panel">
                <SessionRows
                  classes={data.classes
                    .filter((c) =>
                      filter === 'upcoming'
                        ? ['scheduled', 'live'].includes(c.status)
                        : c.status === filter,
                    )
                    .sort(compareSessions)}
                  onOpen={openClass}
                  onEdit={coach ? editSession : undefined}
                  onCancel={
                    coach
                      ? async (c) => {
                          try {
                            await command({ action: 'classControl', id: c.id, control: 'cancel' });
                            notify('Session cancelled.');
                          } catch {}
                        }
                      : undefined
                  }
                />
              </div>
            </>
          )}
          {activeView === 'plans' && (
            <>
              <PageHeading
                eyebrow="TRAIN WITH INTENTION"
                title="Good plans. Better movement."
                text="Give every session a clear purpose."
                action={
                  coach ? (
                    <button
                      className="button dark"
                      onClick={() => {
                        setSelectedPlan(null);
                        show('plan');
                      }}
                    >
                      <Plus size={17} /> Create plan
                    </button>
                  ) : undefined
                }
              />
              <SectionTitle
                title="Your workout plans"
                detail={`${searchPlans.length} plans ready for your studio`}
              />
              <div className="plan-grid">
                {searchPlans.map((p, i) => (
                  <button
                    className="panel workout-card"
                    key={p.id}
                    onClick={() => {
                      setSelectedPlan(p);
                      show('plan');
                    }}
                  >
                    <div className={`workout-cover ${['lavender', 'lime', 'peach'][i % 3]}`}>
                      <ExerciseArt exercise={p.blocks[0]?.exercise} />
                      <span className="pill">{p.blocks.length} EXERCISES</span>
                      <span className="cover-arrow">
                        <ArrowUpRight size={20} />
                      </span>
                    </div>
                    <div className="workout-info">
                      <span className="eyebrow">COACH-CREATED PLAN</span>
                      <h3>{p.name}</h3>
                      <p>{p.description}</p>
                      <footer>
                        <Dumbbell size={15} />
                        {p.blocks.reduce((n, b) => n + b.sets, 0)} sets<span>·</span>
                        {p.blocks.some((b) => isHoldExercise(b.exercise))
                          ? 'Reps & holds'
                          : 'Rep-based training'}
                      </footer>
                    </div>
                  </button>
                ))}
              </div>
              {!searchPlans.length && (
                <EmptyState
                  title="A strong session starts with a plan."
                  text="Add exercises, set a comfortable pace, and make recovery part of the work."
                  action={
                    coach ? (
                      <button
                        className="button lime"
                        onClick={() => {
                          setSelectedPlan(null);
                          show('plan');
                        }}
                      >
                        Create plan
                      </button>
                    ) : undefined
                  }
                />
              )}
              <SectionTitle
                title="Movement library"
                detail={`${exercises.length} tracked movements. Clear guidance for each one.`}
              />
              <div className="exercise-grid">
                {exercises.map((e) => (
                  <button
                    className="exercise-tile"
                    key={e.id}
                    onClick={() => {
                      go('practice');
                    }}
                  >
                    <div className={`exercise-cover ${e.color}`}>
                      <ExerciseArt exercise={e.id} />
                    </div>
                    <h3>{e.name}</h3>
                    <p>
                      {e.group} · {e.equipment}
                    </p>
                    <span>
                      {e.view}
                      <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {activeView === 'analytics' && (
            <>
              <TrainingProgress
                key={progressClient}
                initialClient={progressClient}
                data={data}
                onPractice={() => go('practice')}
                onRefresh={refresh}
              />
              <section className="panel">
                <SectionTitle title="Session history" />
                <SessionRows classes={history} onOpen={openClass} />
              </section>
            </>
          )}
          {activeView === 'settings' && (
            <>
              <PageHeading
                eyebrow="YOUR SPACE, YOUR WAY"
                title="Make yourself at home."
                text="Manage your profile, membership, and privacy."
              />
              <div className="settings-grid">
                <section className="panel">
                  <SectionTitle title="Your profile" />
                  <form
                    className="form-stack"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      try {
                        await command({
                          action: 'profile',
                          name: f.get('name'),
                          goal: f.get('goal'),
                        });
                        notify('Profile saved.');
                      } catch {}
                    }}
                  >
                    <label>
                      Name
                      <input
                        name="name"
                        defaultValue={data.user.name}
                        minLength={2}
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      Email
                      <input value={data.user.email} disabled />
                    </label>
                    <label>
                      My focus
                      <input
                        name="goal"
                        defaultValue={data.user.goal}
                        maxLength={160}
                        minLength={2}
                        required
                      />
                    </label>
                    <button className="button dark" disabled={busy}>
                      Save profile
                    </button>
                  </form>
                </section>
                <section className="panel">
                  <SectionTitle title="Privacy, by design" />
                  <div className="settings-feature">
                    <ShieldCheck size={21} />
                    <div>
                      <h3>Analysis stays close to you.</h3>
                      <p>
                        Camera frames are processed on your device. Live video is shared only after
                        you join a class and consent to its group setting. No video is recorded.
                      </p>
                    </div>
                  </div>
                  <Link href="/privacy" className="text-link">
                    Read the privacy guide
                    <ArrowUpRight size={16} />
                  </Link>
                  <div className="settings-feature">
                    <Download size={21} />
                    <div>
                      <h3>Your data belongs with you.</h3>
                      <p>Download your profile, memberships, and workout summaries.</p>
                    </div>
                  </div>
                  {data.demo ? (
                    <button
                      className="button outline"
                      onClick={() => notify('Create an account to export your own data.')}
                    >
                      Export my data
                    </button>
                  ) : (
                    <a className="button outline" href="/api/export">
                      Export my data
                    </a>
                  )}
                </section>
                {admin && (
                  <section className="panel">
                    <SectionTitle
                      title="Studio membership"
                      action={<span className="pill">{data.billing}</span>}
                    />
                    <p>
                      Payment services are{' '}
                      {data.services.billing
                        ? 'configured for your studio.'
                        : 'not connected yet. Contact the studio admin for payment options.'}
                    </p>
                    <button
                      className="button outline"
                      disabled={!data.services.billing || data.demo}
                      onClick={async () => {
                        try {
                          const r = await fetchJson<{ url: string }>('/api/billing', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: data.billing === 'active' ? 'portal' : 'checkout',
                            }),
                          });
                          window.location.href = r.url;
                        } catch (err) {
                          notify(err instanceof Error ? err.message : 'Please retry.');
                        }
                      }}
                    >
                      {data.billing === 'active'
                        ? 'Manage subscription'
                        : 'View subscription checkout'}
                      <ArrowUpRight size={16} />
                    </button>
                  </section>
                )}
                <section className="panel">
                  <SectionTitle title="Account" />
                  <p>
                    {data.demo
                      ? 'You’re exploring the sample studio. Create an account for your own workspace.'
                      : 'Your personal profile is separate from studio permissions. An admin manages coach invitations and assignments.'}
                  </p>
                  {data.demo ? (
                    <Link href="/login" className="button lime">
                      Create an account
                      <ArrowRight size={16} />
                    </Link>
                  ) : (
                    <button
                      className="button outline"
                      onClick={async () => {
                        await authClient.signOut();
                        window.location.href = '/login';
                      }}
                    >
                      <LogOut size={17} /> Sign out
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
          {activeView === 'practice' && <CameraPractice data={data} />}
          {activeView === 'studio' && (
            <Studio
              initialClass={activeClass || upcoming[0]}
              user={data.user}
              demo={data.demo}
              services={data.services}
              onExit={() => {
                setActiveClass(null);
                go('sessions');
              }}
              onDemoControl={command}
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>Small steps. Stronger tomorrows.</span>
          <span>
            Geez Squad <span className="brand-period">✳</span>
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {error && !modal && (
        <div className="toast error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {data.user.role === 'unset' && (
        <Onboarding
          invited={view === 'setup'}
          userName={data.user.name}
          busy={busy}
          error={error}
          onSubmit={async (payload) => {
            try {
              await command(payload);
              const invite = new URLSearchParams(window.location.search).get('invite');
              window.location.href = invite ? `/invite?code=${encodeURIComponent(invite)}` : '/app';
            } catch {}
          }}
        />
      )}
      {modal && (
        <Modal
          title={
            modal === 'invite'
              ? 'Invite someone to move better.'
              : modal === 'schedule'
                ? selectedSession
                  ? 'Edit scheduled session'
                  : 'Make time for a great session.'
                : modal === 'plan'
                  ? selectedPlan?.name || 'Build your next workout.'
                  : modal === 'client'
                    ? currentClient?.name || 'Client profile'
                    : modal === 'checkIn'
                      ? 'How are you feeling today?'
                      : modal === 'notifications'
                        ? 'Coming up in your studio'
                        : modal === 'studioInfo'
                          ? 'Your studio'
                          : 'A little guidance goes a long way.'
          }
          wide={modal === 'plan' || modal === 'schedule'}
          onClose={() => setModal(null)}
        >
          {modal === 'invite' && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const r = await command({
                    action: 'invite',
                    email: new FormData(e.currentTarget).get('email'),
                  });
                  setInviteResult(String(r.url));
                } catch {}
              }}
            >
              <p>
                Share a personal invite link with your client. It is bound to their email and
                expires after 7 days.
              </p>
              <label>
                Client’s email
                <input name="email" type="email" placeholder="client@example.com" required />
              </label>
              <button className="button dark" disabled={busy}>
                Create invite link
                <ArrowRight size={17} />
              </button>
              {inviteResult && (
                <div className="invite-result">
                  <p>
                    {data.demo
                      ? inviteResult
                      : 'Your invite link is ready. Share it directly with your client.'}
                  </p>
                  {!data.demo && (
                    <>
                      <input aria-label="Invitation link" readOnly value={inviteResult} />
                      <button
                        type="button"
                        className="button outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(inviteResult);
                            notify('Invite link copied.');
                          } catch {
                            notify('Select the link and copy it manually.');
                          }
                        }}
                      >
                        <Copy size={16} /> Copy link
                      </button>
                    </>
                  )}
                </div>
              )}
            </form>
          )}
          {modal === 'schedule' && (
            <ScheduleForm
              key={selectedSession?.id ?? 'new'}
              session={selectedSession}
              data={data}
              busy={busy}
              onSubmit={async (payload) => {
                try {
                  await command(payload);
                  setModal(null);
                  notify(
                    selectedSession
                      ? 'Session updated.'
                      : data.demo
                        ? 'Sample session added.'
                        : 'Session scheduled.',
                  );
                } catch {}
              }}
            />
          )}
          {modal === 'plan' && (
            <PlanForm
              plan={selectedPlan}
              editable={coach && selectedPlan?.canEdit !== false}
              busy={busy}
              onSubmit={async (payload) => {
                try {
                  await command(payload);
                  setModal(null);
                  notify('Workout plan saved.');
                } catch {}
              }}
              onDelete={async () => {
                if (!selectedPlan) return;
                try {
                  await command({ action: 'deletePlan', id: selectedPlan.id });
                  setModal(null);
                  notify('Workout plan deleted.');
                } catch {}
              }}
            />
          )}
          {modal === 'client' && currentClient && (
            <div className="client-detail">
              <Avatar name={currentClient.name} />
              <p>{currentClient.email}</p>
              <div className="goal-pill">{currentClient.goal}</div>
              <ClientManagement
                key={currentClient.id}
                client={currentClient}
                data={data}
                busy={busy}
                onSave={command}
                onRemoved={() => {
                  setModal(null);
                  setSelectedClient(null);
                  notify('Trainee removed from studio.');
                }}
              />
              <ClientCoaching
                client={currentClient}
                data={data}
                onSave={command}
                busy={busy}
                onProgress={() => {
                  setModal(null);
                  go('analytics');
                  setProgressClient(currentClient.id);
                }}
              />
              <SectionTitle
                title="Training together"
                detail={`Joined ${dateLabel(currentClient.joinedAt)}`}
              />
              <SessionRows
                classes={data.classes.filter((c) =>
                  c.participants.some((p) => p.id === currentClient.id),
                )}
                onOpen={async (c) => {
                  setModal(null);
                  await openClass(c);
                }}
              />
            </div>
          )}
          {modal === 'checkIn' && <CheckInForm onSave={command} busy={busy} />}
          {modal === 'notifications' && (
            <SessionRows
              classes={upcoming.slice(0, 5)}
              onOpen={async (c) => {
                setModal(null);
                await openClass(c);
              }}
            />
          )}
          {modal === 'studioInfo' && (
            <div className="form-stack">
              <p>
                <strong>{data.studio?.name || 'Your studio is being set up'}</strong>
              </p>
              <p>
                {data.demo
                  ? 'This sample shows the coaching experience. All people and history are illustrative. Use camera practice for actual local pose analysis.'
                  : `You’re signed in as ${data.user.name}, with the ${data.user.role} role.`}
              </p>
              <Link className="button lime" href={data.demo ? '/login' : '/app?view=settings'}>
                {data.demo ? 'Create your own studio' : 'Manage your profile'}
                <ArrowRight size={16} />
              </Link>
            </div>
          )}
          {modal === 'help' && (
            <div className="resource-list">
              <h3>Get camera-ready</h3>
              <p>
                Use a side view, good lighting, and a stable camera. Keep the required joints in
                frame and leave space around you.
              </p>
              <h3>Understand your estimates</h3>
              <p>
                Tracking confidence measures visibility. Form estimates compare a limited set of
                joint angles and alignment rules. Your coach can adapt guidance to you.
              </p>
              <h3>A shared space to train</h3>
              <p>
                Your camera and microphone are shared with the group only after you join and agree.
                Movement summaries are visible to you and your coach. You can leave video at any
                time.
              </p>
              <Link href="/privacy" className="text-link">
                Camera use & privacy
                <ArrowUpRight size={16} />
              </Link>
              <button
                className="button lime"
                onClick={() => {
                  setModal(null);
                  go('practice');
                }}
              >
                Try camera practice
                <ScanLine size={17} />
              </button>
            </div>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <section className="stat-card">
      <div>
        <span>{label}</span>
        <span className={`stat-icon ${color}`}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
function SessionRows({
  classes,
  onOpen,
  onCancel,
  onEdit,
}: {
  classes: ClassView[];
  onOpen: (c: ClassView) => void;
  onCancel?: (c: ClassView) => void;
  onEdit?: (c: ClassView) => void;
}) {
  const { timeLabel, timeZone } = useTimeFormat();
  if (!classes.length)
    return (
      <EmptyState
        title="A little space for what’s next."
        text="Sessions will appear here when they’re scheduled or completed."
      />
    );
  return (
    <div className="session-list">
      {classes.map((c) => (
        <div className="session-row" key={c.id}>
          <div className="session-date">
            <strong>
              {Number(
                new Date(c.startsAt).toLocaleDateString('en-IN', { day: 'numeric', timeZone }),
              )}
            </strong>
            <span>
              {new Date(c.startsAt).toLocaleDateString('en-IN', { month: 'short', timeZone })}
            </span>
          </div>
          <div className="session-info">
            <strong>{c.title}</strong>
            <span>
              {timeLabel(c.startsAt)}–
              {timeLabel(new Date(Date.parse(c.startsAt) + c.duration * 60000).toISOString())} ·{' '}
              {c.duration} min · {c.participantCount ?? c.participants.length}{' '}
              {(c.participantCount ?? c.participants.length) === 1 ? 'participant' : 'participants'}
            </span>
          </div>
          <span className={`pill ${c.status === 'live' ? 'live-pill' : ''}`}>{c.status}</span>
          <button className="button outline small-button" onClick={() => onOpen(c)}>
            {['completed', 'cancelled'].includes(c.status)
              ? 'View'
              : c.status === 'live'
                ? 'Join session'
                : 'Open studio'}
            <ArrowUpRight size={15} />
          </button>
          {c.status === 'scheduled' && onEdit && c.permissions?.canManage !== false && (
            <button
              className="button outline small-button"
              onClick={() => onEdit(c)}
              aria-label={`Edit ${c.title}`}
            >
              <Pencil size={15} />
              Edit
            </button>
          )}
          {c.status === 'scheduled' && onCancel && c.permissions?.canManage !== false && (
            <button
              className="icon-button"
              aria-label={`Cancel ${c.title}`}
              onClick={() => onCancel(c)}
            >
              <X size={17} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
const Camera = dynamic(() => import('./camera-analyzer').then((m) => m.CameraAnalyzer), {
  ssr: false,
});
function CameraPractice({ data }: { data: WorkspaceData }) {
  const [exercise, setExercise] = useState<ClassView['exercise']>('squat');
  const [saveHistory, setSaveHistory] = useState(false);
  const [assignedBlock, setAssignedBlock] = useState(-1);
  const assignment = data.assignments.find((a) => a.userId === data.user.id);
  const plan = data.plans.find((p) => p.id === assignment?.planId);
  return (
    <section className="meeting-practice">
      <div className="practice-heading">
        <div>
          <span className="eyebrow">CAMERA PRACTICE</span>
          <h1>Focus on your movement.</h1>
          <p>Choose a movement, position your camera, then start your set.</p>
        </div>
        <label>
          Movement
          <select
            aria-label="Exercise to practice"
            value={exercise}
            onChange={(event) => setExercise(event.target.value as ClassView['exercise'])}
          >
            {exercises.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="practice-options">
        {plan && (
          <label>
            Assigned plan: {plan.name}
            <select
              aria-label="Assigned plan exercise"
              value={assignedBlock}
              onChange={(event) => {
                const index = Number(event.target.value);
                setAssignedBlock(index);
                if (index >= 0) setExercise(plan.blocks[index].exercise);
              }}
            >
              <option value={-1}>Choose an exercise</option>
              {plan.blocks.map((block, index) => (
                <option key={index} value={index}>
                  {index + 1}. {exerciseName(block.exercise)} · {block.sets} sets
                </option>
              ))}
            </select>
          </label>
        )}
        {!data.demo && (
          <label className="history-consent">
            <input
              type="checkbox"
              checked={saveHistory}
              onChange={(event) => setSaveHistory(event.target.checked)}
            />
            <span>Save workout history to my profile and share with my coach</span>
          </label>
        )}
      </div>
      <Camera
        exercise={exercise}
        block={
          assignedBlock >= 0 && plan?.blocks[assignedBlock]?.exercise === exercise
            ? plan.blocks[assignedBlock]
            : undefined
        }
        saveForUser={saveHistory ? data.user.id : undefined}
        historyUserId={!data.demo ? data.user.id : undefined}
      />
      <p className="practice-privacy">
        Camera frames are processed on this device.{' '}
        {saveHistory
          ? 'Set summaries are saved to your profile and available to your coach.'
          : 'Practice history stays on this page unless you enable saving.'}
      </p>
    </section>
  );
}
function PlanForm({
  plan,
  editable,
  busy,
  onSubmit,
  onDelete,
}: {
  plan: Plan | null;
  editable: boolean;
  busy: boolean;
  onSubmit: (c: Command) => void;
  onDelete: () => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>(plan?.blocks || starterBlocks),
    [confirm, setConfirm] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit({
          action: 'savePlan',
          id: plan?.id,
          name: f.get('name'),
          description: f.get('description'),
          blocks,
        });
      }}
    >
      <label>
        Plan name
        <input
          name="name"
          defaultValue={plan?.name}
          placeholder="Full body foundations"
          minLength={2}
          maxLength={80}
          required
          disabled={!editable}
        />
      </label>
      <label>
        A little context
        <textarea
          name="description"
          defaultValue={plan?.description}
          placeholder="What will this session focus on?"
          maxLength={400}
          disabled={!editable}
        />
      </label>
      <div className="plan-blocks">
        {blocks.map((b, i) => (
          <div className="plan-block" key={i}>
            <span className="block-number">{String(i + 1).padStart(2, '0')}</span>
            <label>
              Exercise
              <select
                aria-label={`Exercise ${i + 1}`}
                value={b.exercise}
                disabled={!editable}
                onChange={(e) =>
                  setBlocks((s) =>
                    s.map((x, j) =>
                      j === i ? { ...x, exercise: e.target.value as Block['exercise'] } : x,
                    ),
                  )
                }
              >
                {exercises.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            {(['sets', 'reps', 'rest'] as const).map((key) => (
              <label key={key}>
                {key === 'reps' && isHoldExercise(b.exercise)
                  ? 'Hold (s)'
                  : key === 'rest'
                    ? 'Rest (s)'
                    : key}
                <input
                  type="number"
                  aria-label={`${key} for exercise ${i + 1}`}
                  min={key === 'rest' ? 0 : 1}
                  max={key === 'sets' ? 10 : key === 'rest' ? 300 : 120}
                  value={b[key]}
                  disabled={!editable}
                  onChange={(e) =>
                    setBlocks((s) =>
                      s.map((x, j) => (j === i ? { ...x, [key]: Number(e.target.value) } : x)),
                    )
                  }
                />
              </label>
            ))}
            <label>
              Load (kg, optional)
              <input
                type="number"
                aria-label={`Load for exercise ${i + 1}`}
                min={0}
                max={500}
                step={0.5}
                value={b.loadKg ?? ''}
                disabled={!editable}
                onChange={(event) =>
                  setBlocks((values) =>
                    values.map((block, index) =>
                      index === i
                        ? {
                            ...block,
                            loadKg:
                              event.target.value === '' ? undefined : Number(event.target.value),
                          }
                        : block,
                    ),
                  )
                }
              />
            </label>
            {editable && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove exercise ${i + 1}`}
                onClick={() => setBlocks((s) => s.filter((_, j) => j !== i))}
                disabled={blocks.length === 1}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <>
          <button
            type="button"
            className="button outline"
            onClick={() =>
              setBlocks((s) => [...s, { exercise: 'squat', sets: 3, reps: 12, rest: 60 }])
            }
            disabled={blocks.length >= 20}
          >
            <Plus size={16} /> Add exercise
          </button>
          <div className="form-actions">
            <button className="button dark" disabled={busy}>
              Save workout plan
              <Check size={17} />
            </button>
            {plan && (
              <button
                type="button"
                className={`button ${confirm ? 'danger' : 'outline'}`}
                disabled={busy}
                onClick={() => (confirm ? onDelete() : setConfirm(true))}
              >
                <Trash2 size={16} />
                {confirm ? 'Confirm delete' : 'Delete plan'}
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
function Onboarding({
  invited,
  userName,
  busy,
  error,
  onSubmit,
}: {
  invited: boolean;
  userName: string;
  busy: boolean;
  error: string;
  onSubmit: (c: Command) => void;
}) {
  const role = 'trainee';
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={headingId}
      className="onboarding-overlay"
      onCancel={(event) => event.preventDefault()}
    >
      <section className="onboarding-card panel">
        <Brand />
        <span className="eyebrow">LET’S FIND YOUR PLACE</span>
        <h1 id={headingId}>How do you want to move?</h1>
        <p>
          {invited
            ? 'Your coach invited you as a trainee. Set up your profile to join.'
            : 'Create your personal training profile. Coaches receive an invitation from a studio admin.'}
        </p>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onSubmit({
              action: 'onboard',
              role,
              name: f.get('name'),
              studioName: f.get('studioName') || undefined,
              adult: f.get('adult') === 'on',
            });
          }}
        >
          <label>
            Your name
            <input name="name" defaultValue={userName} required minLength={2} maxLength={80} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="adult" required />I am 18 or older. I understand this is
            general fitness coaching.
          </label>
          <p className="microcopy">
            Your personal profile stays yours. Studio access is granted separately. Camera use and
            sharing have their own consent step.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="button dark full" disabled={busy}>
            Create my workspace
            <ArrowRight size={17} />
          </button>
        </form>
        <button
          className="text-link"
          onClick={async () => {
            await authClient.signOut();
            window.location.href = '/login';
          }}
        >
          Back to sign in
        </button>
      </section>
    </dialog>
  );
}
