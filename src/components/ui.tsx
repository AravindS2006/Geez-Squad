'use client';
import { useEffect, useId, useRef } from 'react';
import { X, ArrowUpRight, Dumbbell } from 'lucide-react';
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        {/* Same geometry as public/icon.svg and marketing/brand/geez-squad-mark.svg. */}
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <rect width="64" height="64" rx="14" style={{ fill: 'var(--brand)' }} />
          <path
            d="M37.47 16.96A16 16 0 1 0 48 32H33"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: 'var(--brand-contrast)' }}
          />
          <circle cx="45.11" cy="22.82" r="4" style={{ fill: 'var(--accent)' }} />
        </svg>
      </span>
      Geez Squad
    </span>
  );
}
export function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string;
  index?: number;
  small?: boolean;
}) {
  return (
    <span className={`avatar avatar-${index % 5} ${small ? 'small' : ''}`} aria-label={name}>
      {name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function MotionArt({ small = false }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 420 300" className={`motion-art ${small ? 'small' : ''}`} aria-hidden="true">
      <circle cx="238" cy="146" r="125" fill="#dafa9a" />
      <circle cx="238" cy="146" r="96" fill="none" stroke="#98bd62" strokeDasharray="2 7" />
      <path d="M48 244H380" stroke="#a8c972" strokeWidth="2" />
      <path
        d="M138 106l48 50 59 8 27 63M186 156l-25 70-57 7"
        fill="none"
        stroke="#292e28"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M151 110l63-34 42 15M151 110l-39-14-30 22"
        fill="none"
        stroke="#292e28"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="142" cy="74" r="23" fill="#292e28" />
      <path d="M280 58l20 18M304 56l-17 24" stroke="#5c8240" strokeWidth="3" />
      <circle cx="350" cy="200" r="17" fill="none" stroke="#4b7332" strokeWidth="2" />
      <circle cx="71" cy="54" r="7" fill="#96ba68" />
      <path d="M235 257c16-21 61-29 84-6" fill="none" stroke="#6e8d48" strokeWidth="2" />
    </svg>
  );
}
export function ExerciseArt({ exercise }: { exercise: string }) {
  return (
    <Dumbbell
      className="exercise-art"
      data-exercise={exercise}
      strokeWidth={1.2}
      aria-hidden="true"
    />
  );
}
export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Dumbbell size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    d?.showModal();
    return () => {
      d?.close();
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function SectionTitle({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
export function TextAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={16} />
    </button>
  );
}
