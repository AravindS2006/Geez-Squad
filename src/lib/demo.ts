import type { WorkspaceData } from './types';
import { starterBlocks } from './catalog';
export function demoData(): WorkspaceData {
  const day = new Date();
  day.setHours(18, 0, 0, 0);
  const clients = [
    ['ava', 'Ava Thompson', 'Build strength'],
    ['leo', 'Leo Martinez', 'Improve consistency'],
    ['mia', 'Mia Chen', 'Move with confidence'],
    ['noah', 'Noah Williams', 'Build endurance'],
    ['zoe', 'Zoe Parker', 'Get stronger'],
    ['sam', 'Sam Wilson', 'Improve mobility'],
  ].map(([id, name, goal]) => ({
    id,
    name,
    goal,
    email: `${id}@example.test`,
    role: 'trainee',
    joinedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  }));
  return {
    demo: true,
    workoutSets: [],
    checkIns: [],
    assignments: [],
    user: {
      id: 'demo-coach',
      name: 'Alex Morgan',
      email: 'alex@example.test',
      role: 'coach',
      goal: 'Help people move better',
    },
    studio: { id: 'sample', name: 'Geez Squad' },
    clients,
    plans: [
      {
        id: 'foundation',
        name: 'Full body foundations',
        description: 'A balanced session to build strength and move with intention.',
        blocks: starterBlocks,
      },
      {
        id: 'upper',
        name: 'Upper body strength',
        description: 'Controlled movement. Stronger with every session.',
        blocks: [
          { exercise: 'pushup', sets: 3, reps: 10, rest: 60 },
          { exercise: 'curl', sets: 3, reps: 12, rest: 45 },
        ],
      },
    ],
    classes: [
      {
        id: 'sample-live',
        title: 'Full body foundations',
        startsAt: day.toISOString(),
        duration: 45,
        capacity: 8,
        status: 'scheduled',
        exercise: 'squat',
        revision: 0,
        paused: false,
        startedAt: null,
        endedAt: null,
        coachId: 'demo-coach',
        coachName: 'Alex Morgan',
        planId: 'foundation',
        participants: clients.slice(0, 4).map((c) => ({
          id: c.id,
          name: c.name,
          helpRequested: false,
          metric: null,
          summary: null,
        })),
      },
      ...[1, 2, 3].map((n) => ({
        id: `history-${n}`,
        title: n === 2 ? 'Upper body strength' : 'Full body foundations',
        startsAt: new Date(Date.now() - n * 86400000).toISOString(),
        duration: 45,
        capacity: 8,
        status: 'completed',
        exercise: 'squat' as const,
        revision: 0,
        paused: false,
        startedAt: null,
        endedAt: new Date(Date.now() - n * 86400000).toISOString(),
        coachId: 'demo-coach',
        coachName: 'Alex Morgan',
        planId: 'foundation',
        participants: clients.slice(0, 4).map((c, i) => ({
          id: c.id,
          name: c.name,
          helpRequested: false,
          metric: null,
          summary: {
            totalReps: 36 + i * 4,
            trackedSamples: 20,
            scoreTotal: (78 + i * 4 + n) * 20,
          },
        })),
      })),
    ],
    billing: 'sample',
    services: { video: false, billing: false, email: false },
  };
}
