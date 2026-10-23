export interface SeedExam {
  id: string;
  slug:
    | "wbcs-prelims"
    | "wbcs-mains"
    | "wbpsc-clerkship-part1"
    | "wbpsc-clerkship-part2"
    | "wbpsc-miscellaneous"
    | "wbpsc-food-si"
    | "wbp-constable-si";
  titleEn: string;
  titleBn: string;
  descriptionEn: string;
  descriptionBn: string;
  totalQuestions: number;
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarksPerWrong: number;
  estimatedCutoffMarks: number;
  isActive: boolean;
}

export interface SeedQuestion {
  id: string;
  examId: string;
  examSlug:
    | "wbcs-prelims"
    | "wbcs-mains"
    | "wbpsc-clerkship-part1"
    | "wbpsc-clerkship-part2"
    | "wbpsc-miscellaneous"
    | "wbpsc-food-si"
    | "wbp-constable-si";
  subjectNameEn: string;
  subjectNameBn: string;
  subtopicSlug: string;
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
  correctOption: "A" | "B" | "C" | "D";
  explanationEn: string;
  explanationBn: string;
  difficulty: "easy" | "moderate" | "hard";
  marksPositive: number;
  marksNegative: number;
  previousYearTag: string;
  isActive: boolean;
}

export const INITIAL_EXAMS: SeedExam[] = [
  {
    id: "exam-wbcs-prelims",
    slug: "wbcs-prelims",
    titleEn: "WBCS Preliminary Examination (Group A/B/C/D)",
    titleBn: "ডব্লিউবিসিএস প্রিলিমিনারি পরীক্ষা (WBCS Prelims)",
    descriptionEn:
      "Comprehensive 200-mark Preliminary mock test covering Indian National Movement, Polity, Bengal Geography, General Science & Current Affairs.",
    descriptionBn:
      "ভারতের জাতীয় আন্দোলন, সংবিধান, পশ্চিমবঙ্গের ভূগোল, সাধারণ বিজ্ঞান ও কারেন্ট অ্যাফেয়ার্সের পূর্ণাঙ্গ প্রিলিমিনারি মক টেস্ট।",
    totalQuestions: 25,
    durationMinutes: 25,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.33,
    estimatedCutoffMarks: 3.0,
    isActive: true,
  },
  {
    id: "exam-clerkship-p1",
    slug: "wbpsc-clerkship-part1",
    titleEn: "WBPSC Clerkship Examination (Part-I MCQ)",
    titleBn: "ডব্লিউবিপিএসসি ক্লার্কশিপ পরীক্ষা (Part-I MCQ)",
    descriptionEn:
      "High-yield Part-I objective test on General Studies, Arithmetic (Madhyamik standard), and General English with -0.25 negative marking.",
    descriptionBn:
      "জেনারেল স্টাডিজ, মাধ্যমিক স্তরের পাটিগণিত এবং জেনারেল ইংলিশের অবজেক্টিভ মক টেস্ট (-০.২৫ নেগেটিভ মার্কিং)।",
    totalQuestions: 20,
    durationMinutes: 20,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.25,
    estimatedCutoffMarks: 2.5,
    isActive: true,
  },
  {
    id: "exam-food-si",
    slug: "wbpsc-food-si",
    titleEn: "WBPSC Food & Supplies Sub-Inspector (Food SI)",
    titleBn: "খাদ্য দপ্তরের সাব-ইন্সপেক্টর পরীক্ষা (Food SI)",
    descriptionEn:
      "General Studies (50 Marks) + Arithmetic (50 Marks) mock test aligned with official WBPSC Food SI pattern.",
    descriptionBn:
      "সাধারণ জ্ঞান ও পাটিগণিতের নির্ধারিত সিলেবাস অনুযায়ী ফুড এসআই মক টেস্ট।",
    totalQuestions: 20,
    durationMinutes: 20,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.25,
    estimatedCutoffMarks: 2.5,
    isActive: true,
  },
  {
    id: "exam-misc-prelims",
    slug: "wbpsc-miscellaneous",
    titleEn: "WBPSC Miscellaneous Services Recruitment Prelims",
    titleBn: "ডব্লিউবিপিএসসি মিসলেনিয়াস সার্ভিসেস প্রিলিমিনারি",
    descriptionEn:
      "General Studies & Arithmetic objective assessment for Miscellaneous Services Prelims.",
    descriptionBn:
      "মিসলেনিয়াস সার্ভিসেস প্রিলিমিনারি পরীক্ষার জেনারেল স্টাডিজ ও পাটিগণিত মক টেস্ট।",
    totalQuestions: 20,
    durationMinutes: 20,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.25,
    estimatedCutoffMarks: 2.5,
    isActive: true,
  },
];

// Questions now live in scripts/data/*.json (shared with the PostgreSQL seed);
// see src/data/firestoreSeed.ts.
