/**
 * Session store: Zustand, deliberately WITHOUT persist middleware.
 * Location, profile, chat, missions, clues and model choice live in
 * memory only and are gone when the app closes (the app's ground rule:
 * nothing about the user is ever stored).
 */

import { create } from 'zustand';
import type { Mission } from '@/sky/missions';
import type { LocalModelInfo } from '@/ai/models';

export interface LocInfo {
  lat: number;
  lon: number;
  tz: string;
  label: string;
  source: 'gps' | 'ip' | 'city';
}

export type KnowledgeLevel = 'beginner' | 'amateur' | 'expert';
export type Equipment = 'eyes' | 'binoculars' | 'telescope';

export interface Profile {
  knowledge: KnowledgeLevel;
  equipment: Equipment;
  /** Time budget for tonight: 10, 30 or 60 minutes. */
  minutes: number;
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionState {
  // --- location (fresh GPS fix every launch; never stored) ---
  location: LocInfo | null;
  locationState: 'idle' | 'locating' | 'denied' | 'ready';
  setLocation: (loc: LocInfo) => void;
  setLocationState: (s: SessionState['locationState']) => void;

  // --- profile (resets each launch to beginner / naked eye / 15 min) ---
  profile: Profile;
  setProfile: (partial: Partial<Profile>) => void;

  // --- active model (re-scanned each launch; no saved choice) ---
  activeModel: LocalModelInfo | null;
  setActiveModel: (m: LocalModelInfo | null) => void;

  // --- Guide chat history (last 8 messages kept) ---
  guideChat: ChatMsg[];
  pushGuideChat: (msg: ChatMsg) => void;
  resetGuideChat: () => void;

  // --- General AI chat history (last 20 messages kept) ---
  generalChat: ChatMsg[];
  pushGeneralChat: (msg: ChatMsg) => void;
  resetGeneralChat: () => void;

  // --- Sky Detective clue progress: object id -> revealed clue count ---
  clueProgress: Record<string, number>;
  revealClue: (objectId: string, clueIndex: number) => void;
  clearClueProgress: (objectId?: string) => void;

  // --- current mission (session-only progress, no journal) ---
  mission: Mission | null;
  setMission: (m: Mission | null) => void;
  completeMissionStep: (stepIndex: number) => void;
  resetMission: () => void;
}

const MAX_CHAT = 8;
const MAX_GENERAL_CHAT = 20;
export const useSessionStore = create<SessionState>((set) => ({
  location: null,
  locationState: 'idle',
  setLocation: (loc) => set({ location: loc, locationState: 'ready' }),
  setLocationState: (locationState) => set({ locationState }),

  profile: { knowledge: 'beginner', equipment: 'eyes', minutes: 15 },
  setProfile: (partial) =>
    set((s) => ({ profile: { ...s.profile, ...partial } })),

  activeModel: null,
  setActiveModel: (activeModel) => set({ activeModel }),

  guideChat: [],
  pushGuideChat: (msg) =>
    set((s) => {
      const chat = [...s.guideChat, msg];
      return { guideChat: chat.slice(-MAX_CHAT) };
    }),
  resetGuideChat: () => set({ guideChat: [] }),

  generalChat: [],
  pushGeneralChat: (msg) =>
    set((s) => {
      const chat = [...s.generalChat, msg];
      return { generalChat: chat.slice(-MAX_GENERAL_CHAT) };
    }),
  resetGeneralChat: () => set({ generalChat: [] }),

  clueProgress: {},
  revealClue: (objectId, clueIndex) =>
    set((s) => ({
      clueProgress: {
        ...s.clueProgress,
        [objectId]: Math.max(s.clueProgress[objectId] ?? 0, clueIndex),
      },
    })),
  clearClueProgress: (objectId) =>
    set((s) => {
      if (!objectId) return { clueProgress: {} };
      const next = { ...s.clueProgress };
      delete next[objectId];
      return { clueProgress: next };
    }),

  mission: null,
  setMission: (mission) => set({ mission }),
  completeMissionStep: (stepIndex) =>
    set((s) => {
      if (!s.mission) return {};
      const done = new Set<number>(s.mission.doneSteps);
      done.add(stepIndex);
      return {
        mission: {
          ...s.mission,
          doneSteps: Array.from(done).sort((a: number, b: number) => a - b),
        },
      };
    }),
  resetMission: () => set({ mission: null }),
}));