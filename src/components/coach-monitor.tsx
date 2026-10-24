'use client';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Hand, Search, X, ChevronLeft, ChevronRight, Send, MicOff } from 'lucide-react';
import type { Participant } from 'livekit-client';
import type { ClassView } from '@/lib/types';
import { COACH_PAGE_SIZE } from '@/lib/meeting-policy';
import { isHoldExercise } from '@/lib/exercise-profiles';
import { armModeLabels } from '@/lib/exercise-library';
import { Avatar } from './ui';

export function freshMetric(person: ClassView['participants'][number], item: ClassView) {
  return person.metric &&
    person.metric.revision === item.revision &&
    person.metric.exercise === item.exercise &&
    !item.paused &&
    Date.now() - Date.parse(person.metric.updatedAt) < 12000
    ? person.metric
    : null;
}

export function CoachMonitor({
  item,
  remote,
  demo,
  focus,
  onFocus,
  onVisible,
  renderVideo,
  renderConnection,
  onCue,
  onHelp,
  onMute,
  connected,
  busy,
  selfVideo,
}: {
  item: ClassView;
  remote: Participant[];
  demo: boolean;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onVisible: (ids: string[]) => void;
  renderVideo: (person: Participant) => ReactNode;
  renderConnection: (person: Participant) => ReactNode;
  onCue: (text: string, recipient?: string) => Promise<boolean>;
  onHelp: (id: string) => void;
  onMute: (id?: string) => void;
  connected: boolean;
  busy: boolean;
  selfVideo: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [comfortable, setComfortable] = useState(true);
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showSelf, setShowSelf] = useState(false);
  const [compact, setCompact] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    const media = matchMedia('(max-width: 760px), (max-width: 950px) and (max-height: 550px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setDraft('');
  }, [focus]);
  const people = useMemo(() => new Map(remote.map((p) => [p.identity, p])), [remote]);
  const needsAttention = (p: ClassView['participants'][number]) => {
    const metric = freshMetric(p, item);
    return (
      p.helpRequested ||
      (connected &&
        people.has(p.id) &&
        (!metric ||
          (!['manual', 'timer'].includes(metric.measurementSource ?? '') &&
            metric.confidence < 0.65))) ||
      metric?.technique === 'adjust'
    );
  };
  const filtered = [...item.participants]
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id),
    )
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) && (!attentionOnly || needsAttention(p)),
    );
  const pageSize = comfortable ? (compact ? 4 : 12) : COACH_PAGE_SIZE;
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const safePage = Math.min(page, lastPage);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const visibleKey = visible.map((p) => p.id).join(',');
  useEffect(() => {
    onVisible([...new Set([...visibleKey.split(',').filter(Boolean), ...(focus ? [focus] : [])])]);
  }, [visibleKey, focus, onVisible]);
  const selected = item.participants.find((p) => p.id === focus);
  const selectedRemote = focus ? people.get(focus) : undefined;
  const selectedMetric = selected ? freshMetric(selected, item) : null;
  const columns =
    visible.length <= 2
      ? visible.length || 1
      : visible.length <= 4
        ? 2
        : visible.length <= 9
          ? 3
          : visible.length <= 16
            ? 4
            : visible.length <= 25
              ? 5
              : 6;
  const helpCount = item.participants.filter((p) => p.helpRequested).length;
  const trackedCount = item.participants.filter(
    (p) => (freshMetric(p, item)?.confidence ?? 0) >= 0.65,
  ).length;
  return (
    <div className={`coach-monitor ${selected ? 'has-inspector' : ''}`}>
      <div className="monitor-toolbar">
        <div className="monitor-summary" aria-label="Class monitoring summary">
          <strong>
            {remote.filter((p) => item.participants.some((t) => t.id === p.identity)).length}/
            {item.participants.length} online
          </strong>
          <span>{trackedCount} tracking</span>
          <button
            type="button"
            className={attentionOnly ? 'active' : ''}
            aria-pressed={attentionOnly}
            onClick={() => {
              setAttentionOnly(!attentionOnly);
              setPage(0);
            }}
          >
            <Hand size={14} /> {helpCount} hands · Attention
          </button>
        </div>
        <button
          className="monitor-tools-toggle"
          type="button"
          aria-label="Gallery tools"
          aria-expanded={toolsOpen}
          aria-controls="gallery-tools"
          onClick={() => setToolsOpen(!toolsOpen)}
        >
          <Search size={18} />
        </button>
        <div id="gallery-tools" className={`monitor-tools ${toolsOpen ? 'is-open' : ''}`}>
          <label className="monitor-search">
            <Search size={15} />
            <input
              aria-label="Find a trainee"
              placeholder="Find trainee"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <select
            aria-label="Gallery density"
            value={comfortable ? 'comfortable' : 'overview'}
            onChange={(e) => {
              setComfortable(e.target.value === 'comfortable');
              setPage(0);
            }}
          >
            <option value="overview">Overview · 36</option>
            <option value="comfortable">Larger · {compact ? 4 : 12}</option>
          </select>
          <button type="button" aria-pressed={showSelf} onClick={() => setShowSelf(!showSelf)}>
            My preview
          </button>
        </div>
      </div>
      <div className="monitor-body">
        <div className="monitor-gallery-wrap">
          <div
            className={`participant-grid meeting-gallery monitor-gallery ${comfortable ? 'comfortable-gallery' : ''}`}
            style={
              {
                '--gallery-columns': columns,
                '--gallery-rows': Math.ceil(visible.length / columns) || 1,
                '--mobile-columns': Math.min(columns, 2),
                '--mobile-rows': Math.ceil(visible.length / 2) || 1,
                '--compact-rows': Math.ceil(visible.length / 3) || 1,
              } as CSSProperties
            }
            role="group"
            aria-label="Class video gallery"
          >
            {visible.map((p, i) => {
              const person = people.get(p.id),
                metric = freshMetric(p, item);
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`participant-tile meeting-tile ${p.helpRequested ? 'needs-attention' : ''} ${person?.isSpeaking ? 'is-speaking' : ''} ${focus === p.id ? 'selected-trainee' : ''}`}
                  aria-label={`Focus ${p.name}${p.helpRequested ? ', help requested' : ''}`}
                  aria-pressed={focus === p.id}
                  onClick={() => onFocus(focus === p.id ? null : p.id)}
                >
                  <div className="participant-feed">
                    {person ? (
                      renderVideo(person)
                    ) : (
                      <div className="meeting-empty-video">
                        <Avatar name={p.name} index={i} />
                        <span>{demo ? 'Preview · camera off' : 'Waiting to join'}</span>
                      </div>
                    )}
                    {p.helpRequested && (
                      <span className="monitor-hand">
                        <Hand size={14} />
                        <span>Help requested</span>
                      </span>
                    )}
                    <div className="meeting-tile-name">
                      <strong>{p.name}</strong>
                      {person && renderConnection(person)}
                    </div>
                  </div>
                  <div className="participant-stats">
                    <span>
                      <strong>
                        {metric
                          ? metric.targetUnit === 'seconds' || isHoldExercise(item.exercise)
                            ? `${metric.holdSeconds}s`
                            : metric.reps
                          : '—'}
                      </strong>{' '}
                      {metric?.targetUnit === 'seconds' || isHoldExercise(item.exercise)
                        ? 'hold'
                        : 'reps'}
                    </span>
                    <span>
                      <strong>
                        {metric?.measurementSource === 'manual' ||
                        metric?.measurementSource === 'timer'
                          ? 'Manual'
                          : !metric
                            ? '—'
                            : metric.technique === 'adjust'
                              ? 'Adjust'
                              : metric.technique === 'steady'
                                ? 'Steady'
                                : 'Uncertain'}
                      </strong>
                    </span>
                    {metric?.arms && (
                      <span className="tile-arm-counts">
                        L {metric.arms.left.reps} · R {metric.arms.right.reps}
                      </span>
                    )}
                    <span
                      className={`monitor-tracking ${(metric?.confidence ?? 0) >= 0.65 ? 'tracked' : 'uncertain'}`}
                      title={item.paused ? 'Paused' : metric ? metric.phase : 'No recent tracking'}
                      aria-label={
                        item.paused
                          ? 'Paused'
                          : (metric?.confidence ?? 0) >= 0.65
                            ? 'Tracking'
                            : 'No recent tracking'
                      }
                    />
                  </div>
                </button>
              );
            })}
            {!visible.length && (
              <div className="monitor-empty">
                <strong>No trainees match</strong>
                <button
                  onClick={() => {
                    setQuery('');
                    setAttentionOnly(false);
                  }}
                >
                  Show all trainees
                </button>
              </div>
            )}
          </div>
          <div className="monitor-pagination">
            <span>
              {filtered.length
                ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, filtered.length)} of ${filtered.length}`
                : '0 trainees'}{' '}
              · Select a trainee for a closer look
            </span>
            {lastPage > 0 && (
              <div>
                <button
                  aria-label="Previous trainees"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {safePage + 1}/{lastPage + 1}
                </span>
                <button
                  aria-label="Next trainees"
                  disabled={safePage === lastPage}
                  onClick={() => setPage(safePage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        {selected && (
          <aside className="monitor-inspector" aria-label="Selected trainee details">
            <div className="monitor-inspector-title">
              <strong>{selected.name}</strong>
              <button aria-label="Close trainee details" onClick={() => onFocus(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="monitor-detail-video">
              {selectedRemote ? (
                renderVideo(selectedRemote)
              ) : (
                <div className="meeting-empty-video">
                  <Avatar name={selected.name} />
                  <span>Camera unavailable</span>
                </div>
              )}
            </div>
            <div className="monitor-inspector-content">
              <div className="monitor-detail-stats">
                <strong>
                  {selectedMetric
                    ? `${selectedMetric.targetUnit === 'seconds' || isHoldExercise(item.exercise) ? `${selectedMetric.holdSeconds}s hold` : `${selectedMetric.reps} reps`}`
                    : 'No recent tracking'}
                </strong>
                <span>
                  {selectedMetric
                    ? ['manual', 'timer'].includes(selectedMetric.measurementSource ?? '')
                      ? 'Manual tracking · coach observation'
                      : `${Math.round(selectedMetric.confidence * 100)}% landmark confidence`
                    : 'Waiting for a fresh summary'}
                </span>
              </div>
              <p>{selectedMetric?.cue || 'Use the live video to observe this trainee.'}</p>
              {selectedMetric?.armMode && (
                <div className="inspector-arm-summary">
                  <strong>{armModeLabels[selectedMetric.armMode]}</strong>
                  <span>
                    Left {selectedMetric.arms?.left.reps ?? '—'} · Right{' '}
                    {selectedMetric.arms?.right.reps ?? '—'}
                  </span>
                </div>
              )}
              {selectedMetric && (
                <small>
                  {selectedMetric.rangeDegrees == null
                    ? 'Range —'
                    : `${Math.round(selectedMetric.rangeDegrees)}° range`}{' '}
                  ·{' '}
                  {selectedMetric.repSeconds == null
                    ? 'Tempo —'
                    : `${selectedMetric.repSeconds.toFixed(1)}s / rep`}
                </small>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSending(true);
                  try {
                    if (await onCue(draft, selected.id)) setDraft('');
                  } finally {
                    setSending(false);
                  }
                }}
              >
                <label htmlFor="monitor-cue">Private coaching cue</label>
                <textarea
                  id="monitor-cue"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={600}
                  rows={2}
                  placeholder="One clear correction…"
                />
                <button
                  className="button lime"
                  disabled={sending || !draft.trim() || item.status !== 'live'}
                >
                  <Send size={15} />
                  {sending ? 'Sending…' : 'Send private cue'}
                </button>
              </form>
              {selected.helpRequested && (
                <button className="button outline" onClick={() => onHelp(selected.id)}>
                  Mark help addressed
                </button>
              )}
              <button
                className="button outline"
                disabled={!connected || busy}
                onClick={() => onMute(selected.id)}
              >
                <MicOff size={15} />
                Mute trainee
              </button>
            </div>
          </aside>
        )}
      </div>
      {showSelf && (
        <div className="monitor-self-preview">
          <button aria-label="Close my preview" onClick={() => setShowSelf(false)}>
            <X size={16} />
          </button>
          {selfVideo}
          <span>You · Coach</span>
        </div>
      )}
    </div>
  );
}
