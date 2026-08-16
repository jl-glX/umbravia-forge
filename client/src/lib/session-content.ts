export type SessionBlockType =
  | "warmup"
  | "mobility"
  | "strength"
  | "technique"
  | "conditioning"
  | "main"
  | "cooldown"
  | "custom";

export interface SessionContentBlock {
  id: string;
  type: SessionBlockType;
  title: string;
  instructions: string;
  exercises: string[];
  sets: string;
  repetitions: string;
  duration: string;
  rest: string;
  percentage: string;
  load: string;
  material: string[];
  adaptations: string;
  mediaUrls: string[];
  notes: string;
}

export interface SessionContent {
  activitySessionId: string;
  className: string;
  trainerId: string;
  terminology: string;
  blocks: SessionContentBlock[];
  commentsEnabled: boolean;
  updatedAt: number | null;
}

export interface SessionProgress {
  activitySessionId: string;
  userId: string;
  completedBlockIds: string[];
  notes: string;
  updatedAt: number | null;
}

export function createSessionBlock(): SessionContentBlock {
  return {
    id: `block-${crypto.randomUUID()}`,
    type: "custom",
    title: "",
    instructions: "",
    exercises: [],
    sets: "",
    repetitions: "",
    duration: "",
    rest: "",
    percentage: "",
    load: "",
    material: [],
    adaptations: "",
    mediaUrls: [],
    notes: "",
  };
}

export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}
