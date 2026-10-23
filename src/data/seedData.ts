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

export const INITIAL_QUESTIONS: SeedQuestion[] = [
  {
    id: "q-wbcs-hist-01",
    examId: "exam-wbcs-prelims",
    examSlug: "wbcs-prelims",
    subjectNameEn: "History of India & National Movement",
    subjectNameBn: "ভারতের ইতিহাস ও জাতীয় আন্দোলন",
    subtopicSlug: "dual-government-bengal-1772",
    subtopicNameEn: "Dual System of Government in Bengal (1765-1772)",
    subtopicNameBn: "বাংলায় দ্বৈত শাসন ব্যবস্থা (১৭৬৫-১৭৭২)",
    stemEn:
      "Who among the following abolished the Dual System of Government in Bengal in 1772?",
    stemBn:
      "নিম্নলিখিতদের মধ্যে কে ১৭৭২ সালে বাংলায় দ্বৈত শাসন ব্যবস্থার (Dual Government) অবসান ঘটান?",
    optionAEn: "Robert Clive",
    optionABn: "রবার্ট ক্লাইভ",
    optionBEn: "Warren Hastings",
    optionBBn: "ওয়ারেন হেস্টিংস",
    optionCEn: "Lord Cornwallis",
    optionCBn: "লর্ড কর্নওয়ালিস",
    optionDEn: "Lord Wellesley",
    optionDBn: "লর্ড ওয়েলেসলি",
    correctOption: "B",
    explanationEn:
      "Warren Hastings abolished the Dual System of Government in 1772, which had been introduced by Robert Clive after the Treaty of Allahabad (1765).",
    explanationBn:
      "১৭৬৫ সালে এলাহাবাদের সন্ধির পর রবার্ট ক্লাইভ প্রবর্তিত দ্বৈত শাসন ব্যবস্থা ১৭৭২ সালে ওয়ারেন হেস্টিংস বাতিল করেন।",
    difficulty: "moderate",
    marksPositive: 1,
    marksNegative: 0.33,
    previousYearTag: "WBCS Prelims 2022",
    isActive: true,
  },
  {
    id: "q-wbcs-polity-02",
    examId: "exam-wbcs-prelims",
    examSlug: "wbcs-prelims",
    subjectNameEn: "Indian Polity & Constitution",
    subjectNameBn: "ভারতের সংবিধান ও রাজনীতি",
    subtopicSlug: "73rd-74th-constitutional-amendment",
    subtopicNameEn: "73rd & 74th Constitutional Amendment Acts",
    subtopicNameBn: "৭৩তম ও ৭৪তম সংবিধান সংশোধনী আইন",
    stemEn:
      "Which Schedule was added to the Constitution of India by the 73rd Constitutional Amendment Act, 1992?",
    stemBn:
      "১৯৯২ সালের ৭৩তম সংবিধান সংশোধনী আইনের মাধ্যমে ভারতীয় সংবিধানে কোন তফসিলটি (Schedule) যুক্ত করা হয়েছে?",
    optionAEn: "9th Schedule",
    optionABn: "নবম তফসিল (9th Schedule)",
    optionBEn: "10th Schedule",
    optionBBn: "দশম তফসিল (10th Schedule)",
    optionCEn: "11th Schedule",
    optionCBn: "একাদশ তফসিল (11th Schedule)",
    optionDEn: "12th Schedule",
    optionDBn: "দ্বাদশ তফসিল (12th Schedule)",
    correctOption: "C",
    explanationEn:
      "The 73rd Amendment Act (1992) added Part IX (Articles 243 to 243-O) and the 11th Schedule containing 29 functional items of the Panchayats.",
    explanationBn:
      "১৯৯২ সালের ৭৩তম সংবিধান সংশোধনী আইনের মাধ্যমে সংবিধানে একাদশ তফসিল (11th Schedule) যুক্ত হয়, যেখানে পঞ্চায়েতের ২৯টি কার্যকরী বিষয়ের উল্লেখ আছে।",
    difficulty: "easy",
    marksPositive: 1,
    marksNegative: 0.33,
    previousYearTag: "WBCS Prelims 2023",
    isActive: true,
  },
  {
    id: "q-wbcs-geo-03",
    examId: "exam-wbcs-prelims",
    examSlug: "wbcs-prelims",
    subjectNameEn: "Geography of West Bengal & India",
    subjectNameBn: "পশ্চিমবঙ্গ ও ভারতের ভূগোল",
    subtopicSlug: "physiography-rivers-west-bengal",
    subtopicNameEn: "Physiography & Rivers of West Bengal",
    subtopicNameBn: "পশ্চিমবঙ্গের ভূপ্রকৃতি ও নদনদী",
    stemEn:
      "The 'Tilpara Barrage' in West Bengal is constructed across which of the following rivers?",
    stemBn:
      "পশ্চিমবঙ্গের 'তিলপাড়া ব্যারেজ' (Tilpara Barrage) কোন নদীর ওপর নির্মিত হয়েছে?",
    optionAEn: "Damodar River",
    optionABn: "দামোদর নদ",
    optionBEn: "Mayurakshi River",
    optionBBn: "ময়ূরাক্ষী নদী",
    optionCEn: "Kangsabati River",
    optionCBn: "কংসাবতী নদী",
    optionDEn: "Teesta River",
    optionDBn: "তিস্তা নদী",
    correctOption: "B",
    explanationEn:
      "Tilpara Barrage is situated near Suri in Birbhum district across the Mayurakshi River (also feeding off the Massanjore / Canada Dam).",
    explanationBn:
      "বীরভূম জেলার সিউড়ির কাছে ময়ূরাক্ষী নদীর ওপর তিলপাড়া ব্যারেজ নির্মিত হয়েছে।",
    difficulty: "moderate",
    marksPositive: 1,
    marksNegative: 0.33,
    previousYearTag: "WBCS Prelims 2021",
    isActive: true,
  },
  {
    id: "q-wbcs-econ-04",
    examId: "exam-wbcs-prelims",
    examSlug: "wbcs-prelims",
    subjectNameEn: "Indian Economy & Five Year Plans",
    subjectNameBn: "ভারতের অর্থনীতি ও পঞ্চবার্ষিকী পরিকল্পনা",
    subtopicSlug: "rbi-monetary-policy-instruments",
    subtopicNameEn: "RBI & Monetary Policy Instruments",
    subtopicNameBn: "রিজার্ভ ব্যাংক ও মুদ্রানীতি",
    stemEn:
      "On the recommendation of which Commission was the Reserve Bank of India (RBI) established under the RBI Act, 1934?",
    stemBn:
      "কোন কমিশনের সুপারিশে ১৯৩৪ সালের আরবিআই আইন অনুযায়ী ভারতীয় রিজার্ভ ব্যাংক (RBI) প্রতিষ্ঠিত হয়েছিল?",
    optionAEn: "Hilton Young Commission",
    optionABn: "হিলটন ইয়ং কমিশন",
    optionBEn: "Nariman Committee",
    optionBBn: "নরিম্যান কমিটি",
    optionCEn: "Narasimham Committee",
    optionCBn: "নরসিমহম কমিটি",
    optionDEn: "C. Rangarajan Committee",
    optionDBn: "সি. রঙ্গরাজন কমিটি",
    correctOption: "A",
    explanationEn:
      "RBI was established on 1 April 1935 in Kolkata based on the recommendations of the Royal Commission on Indian Currency and Finance (Hilton Young Commission, 1926).",
    explanationBn:
      "১৯২৬ সালের হিলটন ইয়ং কমিশনের (Royal Commission on Indian Currency and Finance) সুপারিশে ১৯৩৫ সালের ১লা এপ্রিল কলকাতায় ভারতীয় রিজার্ভ ব্যাংক প্রতিষ্ঠিত হয়।",
    difficulty: "easy",
    marksPositive: 1,
    marksNegative: 0.33,
    previousYearTag: "WBCS Prelims 2022",
    isActive: true,
  },
  {
    id: "q-wbcs-sci-05",
    examId: "exam-wbcs-prelims",
    examSlug: "wbcs-prelims",
    subjectNameEn: "General Science & Environment",
    subjectNameBn: "সাধারণ বিজ্ঞান ও পরিবেশ",
    subtopicSlug: "cell-biology-vitamins-nutrition",
    subtopicNameEn: "Vitamins, Enzymes & Human Nutrition",
    subtopicNameBn: "ভিটামিন, উৎসেচক ও মানব পুষ্টি",
    stemEn:
      "Which metal ion is present at the core of the Vitamin B12 (Cyanocobalamin) molecule?",
    stemBn:
      "ভিটামিন B12 (সায়ানোকোবালামিন) অণুর কেন্দ্রে কোন ধাতব আয়নটি উপস্থিত থাকে?",
    optionAEn: "Magnesium (Mg)",
    optionABn: "ম্যাগনেসিয়াম (Mg)",
    optionBEn: "Iron (Fe)",
    optionBBn: "লোহা (Fe)",
    optionCEn: "Cobalt (Co)",
    optionCBn: "কোবাল্ট (Co)",
    optionDEn: "Zinc (Zn)",
    optionDBn: "জিঙ্ক (Zn)",
    correctOption: "C",
    explanationEn:
      "Vitamin B12 is chemically known as Cyanocobalamin because it contains a Cobalt (Co) ion coordinated at the center of a corrin ring.",
    explanationBn:
      "ভিটামিন B12-এর রাসায়নিক নাম সায়ানোকোবালামিন, যার করিন বলয়ের কেন্দ্রে কোবাল্ট (Cobalt) ধাতব আয়ন থাকে।",
    difficulty: "easy",
    marksPositive: 1,
    marksNegative: 0.33,
    previousYearTag: "WBPSC Clerkship / WBCS 2021",
    isActive: true,
  },
  {
    id: "q-clerk-01",
    examId: "exam-clerkship-p1",
    examSlug: "wbpsc-clerkship-part1",
    subjectNameEn: "General Studies & Bengal Heritage",
    subjectNameBn: "সাধারণ জ্ঞান ও বাংলার ঐতিহ্য",
    subtopicSlug: "bengal-renaissance-reformers",
    subtopicNameEn: "Bengal Renaissance & Social Reformers",
    subtopicNameBn: "বাংলার নবজাগরণ ও সমাজ সংস্কারক",
    stemEn:
      "Who founded the 'Atmiya Sabha' in Kolkata in 1815 to propagate monotheistic Hindu Vedanta ideals?",
    stemBn:
      "১৮১৫ সালে কলকাতায় একেশ্বরবাদী বেদান্ত দর্শনের প্রচারের জন্য কে 'আত্মীয় সভা' প্রতিষ্ঠা করেন?",
    optionAEn: "Ishwar Chandra Vidyasagar",
    optionABn: "ঈশ্বরচন্দ্র বিদ্যাসাগর",
    optionBEn: "Raja Rammohan Roy",
    optionBBn: "রাজা রামমোহন রায়",
    optionCEn: "Debendranath Tagore",
    optionCBn: "দেবেন্দ্রনাথ ঠাকুর",
    optionDEn: "Keshab Chandra Sen",
    optionDBn: "কেশবচন্দ্র সেন",
    correctOption: "B",
    explanationEn:
      "Raja Rammohan Roy established the Atmiya Sabha in 1815 in Kolkata, which later evolved into the Brahmo Sabha (1828).",
    explanationBn:
      "রাজা রামমোহন রায় ১৮১৫ সালে কলকাতায় 'আত্মীয় সভা' প্রতিষ্ঠা করেন, যা পরবর্তীতে ১৮২৮ সালে ব্রাহ্ম সমাজে রূপান্তরিত হয়।",
    difficulty: "easy",
    marksPositive: 1,
    marksNegative: 0.25,
    previousYearTag: "WBPSC Clerkship 2020",
    isActive: true,
  },
];
