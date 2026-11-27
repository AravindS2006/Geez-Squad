'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Hand, Search, X, ChevronLeft, ChevronRight, Send, MicOff, Move } from 'lucide-react';
import type { Participant } from 'livekit-client';
import type { ClassView } from '@/lib/types';
import { COACH_PAGE_SIZE } from '@/lib/meeting-policy';
import { isHoldExercise } from '@/lib/exercise-profiles';
import { limbModeLabel } from '@/lib/exercise-library';
import { galleryTileDescription, galleryTileName } from '@/lib/live-room-a11y';
import {
  CORNERS,
  DEFAULT_TILE_ASPECT,
  isCorner,
  packGallery,
  type Corner,
  type Size,
} from '@/lib/room-layout';
import { Avatar } from './ui';
import { useCornerDrag } from './use-corner-drag';

const selfPreviewKey = 'geez-squad:coach-preview-corner:v1';
/** Matches the scrolling grid's smallest row on short screens. */
const MIN_PACKED_TILE_HEIGHT = 120;

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
  /** `onAspect` receives the video's width / height so the gallery can fit its shape. */
  renderVideo: (person: Participant, onAspect?: (aspect: number) => void) => ReactNode;
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
  const [selfCorner, setSelfCorner] = useState<Corner>('top-right');
  // Each trainee's video shape (width / height), reported by the video element.
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const reportAspect = useCallback((id: string, aspect: number) => {
    setAspects((current) =>
      Math.abs((current[id] ?? 0) - aspect) < 0.01 ? current : { ...current, [id]: aspect },
    );
  }, []);
  const galleryRef = useRef<HTMLDivElement>(null);
  const [gallerySize, setGallerySize] = useState<(Size & { gap: number }) | null>(null);
  useEffect(() => {
    const element = galleryRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      const gap = parseFloat(getComputedStyle(element).rowGap) || 0;
      setGallerySize((current) =>
        current && current.width === width && current.height === height && current.gap === gap
          ? current
          : { width, height, gap },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const moveSelf = (corner: Corner) => {
    setSelfCorner(corner);
    try {
      localStorage.setItem(selfPreviewKey, corner);
    } catch {
      // Moving still works for this visit.
    }
  };
  const selfDrag = useCornerDrag({
    enabled: showSelf,
    bounds: (tile) => tile.closest('.coach-monitor'),
    onDrop: moveSelf,
  });
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
  // A phone held upright sends 9:16 video, which leaves wide empty bars in an equal-cell
  // grid. When any visible camera is portrait (and the gallery is not the scrolling phone
  // grid), tiles take their video's own shape in justified rows instead.
  const tileAspects = visible.map((p) =>
    people.has(p.id) ? (aspects[p.id] ?? DEFAULT_TILE_ASPECT) : DEFAULT_TILE_ASPECT,
  );
  const packed =
    !compact && gallerySize && tileAspects.some((aspect) => aspect < 1)
      ? packGallery(tileAspects, gallerySize, gallerySize.gap)
      : [];
  // Short windows keep the scrolling grid rather than shrinking tiles below a usable size.
  const packedReady =
    packed.length > 0 &&
    packed.length === visible.length &&
    Math.min(...packed.map((rect) => rect.height)) >= MIN_PACKED_TILE_HEIGHT;
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
        <div className="monitor-pagination" aria-label="Gallery pages" role="group">
          <span>
            {filtered.length
              ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, filtered.length)} of ${filtered.length}`
              : '0 trainees'}
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
          <button
            type="button"
            aria-pressed={showSelf}
            onClick={() => {
              if (!showSelf)
                try {
                  // Read the saved corner when the preview opens (an event, not an effect).
                  const saved = localStorage.getItem(selfPreviewKey);
                  if (isCorner(saved)) setSelfCorner(saved);
                } catch {
                  // The preview still opens in its default corner.
                }
              setShowSelf(!showSelf);
            }}
          >
            My preview
          </button>
        </div>
      </div>
      <div className="monitor-body">
        <div className="monitor-gallery-wrap">
          <div
            ref={galleryRef}
            className={`participant-grid meeting-gallery monitor-gallery ${comfortable ? 'comfortable-gallery' : ''}${packedReady ? ' packed-gallery' : ''}`}
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
                metric = freshMetric(p, item),
                timed = metric?.targetUnit === 'seconds' || isHoldExercise(item.exercise),
                descriptionId = `tile-stats-${p.id}`;
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`participant-tile meeting-tile ${p.helpRequested ? 'needs-attention' : ''} ${person?.isSpeaking ? 'is-speaking' : ''} ${focus === p.id ? 'selected-trainee' : ''}`}
                  aria-label={galleryTileName(p)}
                  aria-describedby={descriptionId}
                  aria-pressed={focus === p.id}
                  onClick={() => onFocus(focus === p.id ? null : p.id)}
                  style={
                    packedReady
                      ? ({
                          '--tile-x': `${packed[i].x}px`,
                          '--tile-y': `${packed[i].y}px`,
                          '--tile-width': `${packed[i].width}px`,
                          '--tile-height': `${packed[i].height}px`,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  {/* The label replaces the visible stats, so they are repeated here. */}
                  <span id={descriptionId} hidden>
                    {galleryTileDescription({
                      name: p.name,
                      helpRequested: p.helpRequested,
                      paused: item.paused,
                      metric: metric
                        ? {
                            reps: metric.reps,
                            holdSeconds: metric.holdSeconds,
                            timed,
                            technique:
                              metric.measurementSource === 'manual' ||
                              metric.measurementSource === 'timer'
                                ? 'manual'
                                : metric.technique === 'steady' || metric.technique === 'adjust'
                                  ? metric.technique
                                  : 'uncertain',
                            tracked: (metric.confidence ?? 0) >= 0.65,
                            arms: metric.arms
                              ? { left: metric.arms.left.reps, right: metric.arms.right.reps }
                              : null,
                          }
                        : null,
                      connection: person ? (person.connectionQuality ?? 'unknown') : null,
                    })}
                  </span>
                  <div className="participant-feed">
                    {person ? (
                      renderVideo(person, (aspect) => reportAspect(p.id, aspect))
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
            {!visible.length && !item.participants.length && (
              <div className="monitor-empty">
                <strong>Waiting for trainees</strong>
                <span>Enrolled trainees appear here as soon as the class roster has members.</span>
              </div>
            )}
            {!visible.length && !!item.participants.length && (
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
                  <strong>{limbModeLabel(item.exercise, selectedMetric.armMode)}</strong>
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
        <div
          className="monitor-self-preview"
          role="group"
          aria-label="My preview"
          data-corner={selfCorner}
          data-dragging={selfDrag.dragging || undefined}
          {...selfDrag.handlers}
        >
          <div className="monitor-self-actions">
            <button
              type="button"
              aria-label={`Move my preview (now ${selfCorner.replace('-', ' ')})`}
              title="Drag the preview, or press to move it to the next corner"
              onClick={() => moveSelf(CORNERS[(CORNERS.indexOf(selfCorner) + 1) % CORNERS.length])}
            >
              <Move size={16} />
            </button>
            <button aria-label="Close my preview" onClick={() => setShowSelf(false)}>
              <X size={16} />
            </button>
          </div>
          {selfVideo}
          <span>You · Coach</span>
        </div>
      )}
    </div>
  );
}
