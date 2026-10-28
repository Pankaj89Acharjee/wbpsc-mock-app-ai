import type { BilingualText, QuestionOptions } from "../../packages/shared-types/src/index";

export type SupportedLang = "en" | "bn";

export type ActiveNav =
  | "mock-center"
  | "weakness-tutor"
  | "descriptive-eval"
  | "daily-ca"
  | "admin-console";

export type AdminSubTab =
  | "users"
  | "plans"
  | "exams"
  | "cache-attempts"
  | "bulk-import"
  | "series";

/** 303 -> "5min 3sec" */
export const formatClock = (sec: number) => `${Math.floor(sec / 60)}min ${sec % 60}sec`;

/** A question as shown during a test — correct answers stay on the server until submission. */
export interface MockQuestion {
  id: string;
  subjectNameEn: string;
  subjectNameBn: string;
  subtopicNameEn: string;
  subtopicNameBn: string;
  stemEn: string;
  stemBn: string;
  optionAEn: string;
  optionABn: string;
  optionBEn: string;
  optionBBn: string;
  optionCEn: string;
  optionCBn: string;
  optionDEn: string;
  optionDBn: string;
  previousYearTag: string;
}

/** Client-safe question shape returned by GET /exams/:id/mock-test and remedial-mock. */
export interface ApiMockQuestion {
  id: string;
  subjectName: BilingualText;
  subtopicName: BilingualText;
  stem: BilingualText;
  options: QuestionOptions;
  previousYearTag: string | null;
}

export const toMockQuestion = (q: ApiMockQuestion): MockQuestion => ({
  id: q.id,
  subjectNameEn: q.subjectName.en,
  subjectNameBn: q.subjectName.bn,
  subtopicNameEn: q.subtopicName.en,
  subtopicNameBn: q.subtopicName.bn,
  stemEn: q.stem.en,
  stemBn: q.stem.bn,
  optionAEn: q.options.A.en,
  optionABn: q.options.A.bn,
  optionBEn: q.options.B.en,
  optionBBn: q.options.B.bn,
  optionCEn: q.options.C.en,
  optionCBn: q.options.C.bn,
  optionDEn: q.options.D.en,
  optionDBn: q.options.D.bn,
  previousYearTag: q.previousYearTag ?? "",
});

export interface SubmitResponse {
  attemptId: string;
  overallSummary: {
    correct: number;
    incorrect: number;
    finalNetScore: number;
    maxPossibleScore: number;
    accuracyPercentage: number;
    cutoffCleared: boolean;
  };
  weakSubtopics: unknown[];
}

export interface DescriptiveEvaluation {
  transcribedAnswer: string;
  estimatedWordCount: number;
  targetWordLimit: number;
  grammarScore: number;
  contentScore: number;
  wordLimitScore: number;
  totalScore: number;
  strengths: string[];
  improvementsNeeded: string[];
  correctedModelAnswer: string;
}
