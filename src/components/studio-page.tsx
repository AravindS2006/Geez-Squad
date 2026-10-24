'use client';
import { Studio } from './studio';
import type { ClassView, WorkspaceData } from '@/lib/types';
export function StudioPage({
  item,
  user,
  services,
  customExercises,
  features,
}: {
  item: ClassView;
  user: WorkspaceData['user'];
  services: WorkspaceData['services'];
  customExercises?: WorkspaceData['customExercises'];
  features?: WorkspaceData['features'];
}) {
  return (
    <main className="standalone-studio">
      <Studio
        initialClass={item}
        user={user}
        services={services}
        customExercises={customExercises}
        features={features}
        demo={false}
        onExit={() => {
          window.location.href = '/app?view=sessions';
        }}
      />
    </main>
  );
}
