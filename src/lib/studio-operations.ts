import { z } from 'zod';

const id = z.string().min(1).max(100);
const text = z.string().trim().max(160);
const email = z.union([z.email().max(254), z.literal('')]).transform((v) => v.toLowerCase());
const phone = z.string().trim().max(30);
const date = z.iso.date();
export const operationsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('memberAccess'),
    memberId: id,
    operation: z.enum(['resend', 'sendEmail', 'restore', 'withdraw']),
  }),
  z.object({
    action: z.literal('studioClass'),
    hostId: id.optional(),
    id: id.optional(),
    title: text.min(2),
    trainer: text.min(2),
    location: text.min(2),
    startsAt: z.iso.datetime(),
    duration: z.number().int().min(10).max(240),
    capacity: z.number().int().min(1).max(100),
    status: z.enum(['scheduled', 'completed', 'cancelled']),
  }),
  z.object({
    action: z.literal('booking'),
    classId: id,
    memberId: id,
    status: z.enum(['booked', 'cancelled']),
  }),
  z.object({
    action: z.literal('member'),
    id: id.optional(),
    name: text.min(2),
    email,
    phone,
    goal: text,
    joinedOn: date,
    status: z.enum(['active', 'paused', 'archived']),
    offerId: id.optional(),
    startsOn: date.optional(),
  }),
  z.object({
    action: z.literal('offer'),
    id: id.optional(),
    name: text.min(2),
    description: z.string().trim().max(400),
    durationDays: z.number().int().min(1).max(730),
    pricePaise: z.number().int().min(0).max(100000000),
    active: z.boolean(),
  }),
  z.object({ action: z.literal('term'), memberId: id, offerId: id, startsOn: date }),
  z.object({ action: z.literal('cancelTerm'), id }),
  z.object({
    action: z.literal('payment'),
    id: z.uuid(),
    termId: id,
    amountPaise: z.number().int().min(1).max(100000000),
    paidOn: date,
    method: z.enum(['UPI', 'Cash', 'Card', 'Bank transfer']),
    reference: text,
  }),
  z.object({ action: z.literal('attendance'), memberId: id, date }),
  z.object({
    action: z.literal('removeAttendance'),
    memberId: id,
    date,
    reason: z.string().trim().min(5).max(300),
  }),
  z.object({
    action: z.literal('enquiry'),
    id: id.optional(),
    name: text.min(2),
    phone: phone.min(3),
    interest: text.min(2),
    source: z.enum(['Walk-in', 'Referral', 'Instagram', 'Website', 'Other']),
    stage: z.enum(['new', 'contacted', 'trial', 'won', 'lost']),
    followUpOn: date,
    note: z.string().trim().max(1000),
  }),
  z.object({
    action: z.literal('staff'),
    id: id.optional(),
    name: text.min(2),
    email,
    phone,
    role: text.min(2),
    specialty: text,
    status: z.enum(['active', 'inactive']),
  }),
  z.object({
    action: z.literal('details'),
    name: text.min(2).max(80),
    address: z.string().trim().max(400),
    phone,
    hours: text,
  }),
]);
export type OperationsCommand = z.infer<typeof operationsSchema>;
export type StudioMember = {
  primaryCoach?: { coachId: string; assignedAt: string | Date } | null;
  userId?: string | null;
  accessStatus?: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  goal: string;
  joinedOn: string;
  status: string;
};
export type MembershipOffer = {
  id: string;
  name: string;
  description: string;
  durationDays: number;
  pricePaise: number;
  active: boolean;
};
export type MemberTerm = {
  id: string;
  memberId: string;
  offerId: string;
  planName: string;
  feePaise: number;
  startsOn: string;
  endsOn: string;
  status: string;
};
export type StudioPayment = {
  id: string;
  termId: string;
  amountPaise: number;
  paidOn: string;
  method: string;
  reference: string;
};
export type StudioAttendance = { id: string; memberId: string; date: string };
export type StudioEnquiry = {
  id: string;
  name: string;
  phone: string;
  interest: string;
  source: string;
  stage: string;
  followUpOn: string;
  note: string;
};
export type StudioStaff = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  specialty: string;
  status: string;
};
export type OperationsData = {
  coaches?: { id: string; name: string }[];
  studioClasses: {
    hostId?: string | null;
    id: string;
    title: string;
    trainer: string;
    location: string;
    startsAt: string;
    duration: number;
    capacity: number;
    status: string;
    bookings: { id: string; memberId: string; status: string }[];
  }[];
  studio: { name: string; address: string; phone: string; hours: string };
  members: StudioMember[];
  offers: MembershipOffer[];
  terms: MemberTerm[];
  payments: StudioPayment[];
  attendance: StudioAttendance[];
  enquiries: StudioEnquiry[];
  staff: StudioStaff[];
};
export const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
export function studioToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function termStatus(term: MemberTerm, today: string) {
  return term.status === 'cancelled'
    ? 'cancelled'
    : term.startsOn > today
      ? 'upcoming'
      : term.endsOn < today
        ? 'expired'
        : 'active';
}
export function outstanding(term: MemberTerm, payments: StudioPayment[]) {
  return Math.max(
    0,
    term.feePaise -
      payments.filter((p) => p.termId === term.id).reduce((sum, p) => sum + p.amountPaise, 0),
  );
}
export function selectCurrentTerm<T extends { startsOn: string; endsOn: string; status: string }>(
  terms: T[],
  today: string,
) {
  return terms
    .filter((t) => t.status !== 'cancelled')
    .sort((a, b) => {
      const activeA = a.startsOn <= today && a.endsOn >= today,
        activeB = b.startsOn <= today && b.endsOn >= today;
      const futureA = a.startsOn > today,
        futureB = b.startsOn > today;
      return (
        Number(activeB) - Number(activeA) ||
        Number(futureB) - Number(futureA) ||
        (futureA && futureB
          ? a.startsOn.localeCompare(b.startsOn)
          : b.endsOn.localeCompare(a.endsOn))
      );
    })[0];
}
export function currentTerm(data: OperationsData, memberId: string, today: string) {
  return selectCurrentTerm(
    data.terms.filter((t) => t.memberId === memberId),
    today,
  );
}
export function validateTerm(
  data: OperationsData,
  memberId: string,
  offerId: string,
  startsOn: string,
) {
  const member = data.members.find((m) => m.id === memberId && m.status === 'active');
  const offer = data.offers.find((p) => p.id === offerId && p.active);
  if (!member || !offer) throw new Error('Choose an active member and an available plan.');
  const endsOn = addDays(startsOn, offer.durationDays - 1);
  if (
    data.terms.some(
      (t) =>
        t.memberId === memberId &&
        t.status !== 'cancelled' &&
        t.startsOn <= endsOn &&
        t.endsOn >= startsOn,
    )
  )
    throw new Error('This membership overlaps an existing term. Choose a later start date.');
  return { member, offer, endsOn };
}
export function applyDemoOperation(
  data: OperationsData,
  command: OperationsCommand,
  newId: string,
): OperationsData {
  const c = command;
  const replace = <T extends { id: string }>(rows: T[], row: T) =>
    rows.some((r) => r.id === row.id)
      ? rows.map((r) => (r.id === row.id ? row : r))
      : [row, ...rows];
  switch (c.action) {
    case 'memberAccess':
      return {
        ...data,
        members: data.members.map((m) =>
          m.id === c.memberId
            ? { ...m, accessStatus: c.operation === 'resend' ? 'pending' : 'withdrawn' }
            : m,
        ),
      };
    case 'studioClass': {
      const existing = data.studioClasses.find((s) => s.id === c.id);
      if (c.status === 'scheduled' && Date.parse(c.startsAt) <= Date.now())
        throw new Error('Schedule a class in the future.');
      if (existing && c.capacity < existing.bookings.filter((b) => b.status === 'booked').length)
        throw new Error('Capacity cannot be smaller than the booked roster.');
      return {
        ...data,
        studioClasses: replace(data.studioClasses, {
          ...c,
          id: c.id || newId,
          bookings: existing?.bookings || [],
        }),
      };
    }
    case 'booking': {
      const item = data.studioClasses.find((s) => s.id === c.classId);
      if (!item || item.status !== 'scheduled' || Date.parse(item.startsAt) <= Date.now())
        throw new Error('Only upcoming scheduled classes accept booking changes.');
      const date = studioToday(new Date(item.startsAt));
      if (
        c.status === 'booked' &&
        (!data.members.some((m) => m.id === c.memberId && m.status === 'active') ||
          !data.terms.some((t) => t.memberId === c.memberId && termStatus(t, date) === 'active'))
      )
        throw new Error('An active membership on the class date is required.');
      const previous = item.bookings.find((b) => b.memberId === c.memberId);
      if (
        c.status === 'booked' &&
        previous?.status !== 'booked' &&
        item.bookings.filter((b) => b.status === 'booked').length >= item.capacity
      )
        throw new Error('This class is full.');
      return {
        ...data,
        studioClasses: data.studioClasses.map((s) =>
          s.id === c.classId
            ? {
                ...s,
                bookings: previous
                  ? s.bookings.map((b) =>
                      b.memberId === c.memberId ? { ...b, status: c.status } : b,
                    )
                  : [...s.bookings, { id: newId, memberId: c.memberId, status: c.status }],
              }
            : s,
        ),
      };
    }
    case 'member': {
      if (c.email && data.members.some((m) => m.email === c.email && m.id !== c.id))
        throw new Error('A member with this email already exists.');
      const previous = data.members.find((m) => m.id === c.id);
      const next = {
        ...data,
        members: replace(data.members, {
          ...previous,
          ...c,
          id: c.id || newId,
          accessStatus: previous?.userId ? 'connected' : c.email ? 'pending' : 'no_email',
        }),
      };
      return c.offerId
        ? applyDemoOperation(
            next,
            {
              action: 'term',
              memberId: c.id || newId,
              offerId: c.offerId,
              startsOn: c.startsOn || studioToday(),
            },
            `${newId}-term`,
          )
        : next;
    }
    case 'offer':
      return { ...data, offers: replace(data.offers, { ...c, id: c.id || newId }) };
    case 'staff':
      return { ...data, staff: replace(data.staff, { ...c, id: c.id || newId }) };
    case 'enquiry':
      return { ...data, enquiries: replace(data.enquiries, { ...c, id: c.id || newId }) };
    case 'details':
      return { ...data, studio: c };
    case 'term': {
      const { offer, endsOn } = validateTerm(data, c.memberId, c.offerId, c.startsOn);
      return {
        ...data,
        terms: [
          {
            id: newId,
            memberId: c.memberId,
            offerId: offer.id,
            planName: offer.name,
            feePaise: offer.pricePaise,
            startsOn: c.startsOn,
            endsOn,
            status: 'active',
          },
          ...data.terms,
        ],
      };
    }
    case 'cancelTerm': {
      if (data.payments.some((p) => p.termId === c.id))
        throw new Error('A paid term cannot be cancelled. Keep it as part of the payment history.');
      return {
        ...data,
        terms: data.terms.map((t) => (t.id === c.id ? { ...t, status: 'cancelled' } : t)),
      };
    }
    case 'payment': {
      if (data.payments.some((p) => p.id === c.id)) return data;
      const term = data.terms.find((t) => t.id === c.termId && t.status !== 'cancelled');
      if (!term || c.amountPaise > outstanding(term, data.payments))
        throw new Error('Payment exceeds the outstanding membership balance.');
      if (c.paidOn > studioToday()) throw new Error('Payment date cannot be in the future.');
      return { ...data, payments: [c, ...data.payments] };
    }
    case 'attendance': {
      if (c.date > studioToday()) throw new Error('Attendance cannot be recorded in the future.');
      if (
        !data.members.some((m) => m.id === c.memberId && m.status === 'active') ||
        !data.terms.some((t) => t.memberId === c.memberId && termStatus(t, c.date) === 'active')
      )
        throw new Error('An active membership is required to check in.');
      return data.attendance.some((a) => a.memberId === c.memberId && a.date === c.date)
        ? data
        : {
            ...data,
            attendance: [{ id: newId, memberId: c.memberId, date: c.date }, ...data.attendance],
          };
    }
    case 'removeAttendance':
      return {
        ...data,
        attendance: data.attendance.filter((a) => a.memberId !== c.memberId || a.date !== c.date),
      };
  }
}
export function classOverlap(
  a: { startsAt: string | Date; duration: number },
  b: { startsAt: string | Date; duration: number },
) {
  const startA = new Date(a.startsAt).getTime(),
    startB = new Date(b.startsAt).getTime();
  return startA < startB + b.duration * 60000 && startB < startA + a.duration * 60000;
}
export function managementInsights(data: OperationsData, today: string) {
  const week = addDays(today, -6),
    nextWeek = addDays(today, 7);
  const active = data.members.filter(
    (m) =>
      m.status === 'active' &&
      data.terms.some((t) => t.memberId === m.id && termStatus(t, today) === 'active'),
  );
  const quiet = active.filter(
    (m) => !data.attendance.some((a) => a.memberId === m.id && a.date >= week && a.date <= today),
  );
  const expiring = active.filter((m) => {
    const t = currentTerm(data, m.id, today);
    return (
      t &&
      t.endsOn <= nextWeek &&
      !data.terms.some(
        (next) => next.memberId === m.id && next.status !== 'cancelled' && next.startsOn > t.endsOn,
      )
    );
  });
  const workload = (data.coaches ?? []).map((coach) => {
    const classes = data.studioClasses.filter(
      (s) =>
        s.hostId === coach.id &&
        s.status === 'scheduled' &&
        studioToday(new Date(s.startsAt)) >= today &&
        studioToday(new Date(s.startsAt)) <= nextWeek,
    );
    return {
      ...coach,
      clients: data.members.filter(
        (m) => m.status === 'active' && m.primaryCoach?.coachId === coach.id,
      ).length,
      classes: classes.length,
      minutes: classes.reduce((sum, s) => sum + s.duration, 0),
    };
  });
  return {
    active,
    quiet,
    expiring,
    workload,
    unassigned: active.filter((m) => m.userId && !m.primaryCoach).length,
  };
}
export function demoOperations(): OperationsData {
  const today = studioToday();
  const names = [
    'Priya Sharma',
    'Arjun Nair',
    'Meera Krishnan',
    'Rohan Patel',
    'Ananya Rao',
    'Vikram Singh',
    'Sara Thomas',
    'Aditya Menon',
    'Diya Kapoor',
    'Rahul Das',
    'Ishita Shah',
    'Karan Verma',
  ];
  const members = names.map((name, i) => ({
    id: `member-${i}`,
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.test`,
    phone: '',
    goal: ['Build strength', 'Improve mobility', 'Stay consistent'][i % 3],
    joinedOn: addDays(today, -60 + i * 3),
    status: i === 10 ? 'paused' : 'active',
  }));
  const offers = [
    {
      id: 'essential',
      name: 'Studio Essential',
      description: 'Your everyday training ritual. Full studio access and group sessions.',
      durationDays: 30,
      pricePaise: 250000,
      active: true,
    },
    {
      id: 'squad',
      name: 'Squad Unlimited',
      description: 'More ways to move. Studio access, all group classes, and live coaching.',
      durationDays: 90,
      pricePaise: 650000,
      active: true,
    },
    {
      id: 'personal',
      name: 'Personal Coaching',
      description: 'Focused attention with a personal training plan and guided sessions.',
      durationDays: 30,
      pricePaise: 800000,
      active: true,
    },
  ];
  const terms = members.map((m, i) => {
    const offer = offers[i % 3];
    return {
      id: `term-${i}`,
      memberId: m.id,
      offerId: offer.id,
      planName: offer.name,
      feePaise: offer.pricePaise,
      startsOn: addDays(today, -offer.durationDays + (i < 3 ? 3 + i : 12 + i)),
      endsOn: addDays(today, i < 3 ? 2 + i : 11 + i),
      status: 'active',
    };
  });
  return {
    studioClasses: [
      {
        id: 'class-strength',
        title: 'Strength foundations',
        trainer: 'Alex Morgan',
        location: 'Main studio',
        startsAt: new Date(`${addDays(today, 1)}T07:00:00+05:30`).toISOString(),
        duration: 45,
        capacity: 12,
        status: 'scheduled',
        bookings: [
          { id: 'booking-1', memberId: 'member-0', status: 'booked' },
          { id: 'booking-2', memberId: 'member-1', status: 'booked' },
        ],
      },
      {
        id: 'class-mobility',
        title: 'Move & reset',
        trainer: 'Neha Pillai',
        location: 'Movement floor',
        startsAt: new Date(`${addDays(today, 1)}T18:00:00+05:30`).toISOString(),
        duration: 60,
        capacity: 10,
        status: 'scheduled',
        bookings: [],
      },
    ],
    studio: {
      name: 'Geez Squad',
      address: '',
      phone: '',
      hours: 'Monday – Saturday · 6 am – 9 pm',
    },
    members,
    offers,
    terms,
    payments: terms.slice(0, 9).map((t, i) => ({
      id: `payment-${i}`,
      termId: t.id,
      amountPaise: i === 2 ? t.feePaise / 2 : t.feePaise,
      paidOn: addDays(today, -i * 2),
      method: ['UPI', 'Cash', 'Card'][i % 3],
      reference: `DEMO-${1001 + i}`,
    })),
    attendance: [0, 1, 2, 4, 5, 7, 8].flatMap((i) =>
      [0, 1, 3, 5, 7, 9].map((d) => ({
        id: `visit-${i}-${d}`,
        memberId: `member-${i}`,
        date: addDays(today, -d),
      })),
    ),
    enquiries: [
      {
        id: 'lead-1',
        name: 'Nisha Raj',
        phone: '',
        interest: 'Strength training',
        source: 'Instagram',
        stage: 'new',
        followUpOn: today,
        note: 'Interested in evening sessions.',
      },
      {
        id: 'lead-2',
        name: 'Dev Anand',
        phone: '',
        interest: 'Personal coaching',
        source: 'Referral',
        stage: 'trial',
        followUpOn: addDays(today, 1),
        note: 'Trial visit to be confirmed.',
      },
      {
        id: 'lead-3',
        name: 'Tara Joseph',
        phone: '',
        interest: 'Group classes',
        source: 'Walk-in',
        stage: 'contacted',
        followUpOn: today,
        note: 'Prefers morning classes.',
      },
    ],
    staff: [
      {
        id: 'staff-1',
        name: 'Alex Morgan',
        email: 'alex@example.test',
        phone: '',
        role: 'Head coach',
        specialty: 'Strength & conditioning',
        status: 'active',
      },
      {
        id: 'staff-2',
        name: 'Neha Pillai',
        email: 'neha@example.test',
        phone: '',
        role: 'Trainer',
        specialty: 'Mobility & functional training',
        status: 'active',
      },
      {
        id: 'staff-3',
        name: 'Sam Wilson',
        email: 'sam@example.test',
        phone: '',
        role: 'Studio manager',
        specialty: 'Member experience',
        status: 'active',
      },
    ],
  };
}
