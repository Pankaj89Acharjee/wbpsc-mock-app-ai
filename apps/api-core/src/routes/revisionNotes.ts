import type { FastifyPluginAsync } from "fastify";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { queryClient } from "../db/index";
import { loadSessionUser, requireAdmin, requireUser } from "../lib/auth";
import type { BilingualText, OptionKey } from "../../../../packages/shared-types/src/index";

// ============================================================================
// Exam-Oriented Quick Revision Notes + Visuals + 30-MCQ Topic Practice Engine
// ============================================================================

export interface RevisionVisualCard {
  id: string;
  titleEn: string;
  titleBn: string;
  subtitleEn: string;
  subtitleBn: string;
  badgeText: string;
  keyFactsEn: string[];
  keyFactsBn: string[];
  svgMarkup: string;
  imageUrl?: string | null;
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const BILINGUAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    en: { type: Type.STRING },
    bn: { type: Type.STRING },
  },
  required: ["en", "bn"],
};

// ============================================================================
// 1. Database Schema Initialization & Rich Default Seeding
// ============================================================================

export async function ensureRevisionNotesSchema(): Promise<void> {
  await queryClient`
    CREATE TABLE IF NOT EXISTS revision_topics (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      exam_slug VARCHAR(80) NOT NULL DEFAULT 'wbcs-prelims',
      subject_en VARCHAR(160) NOT NULL,
      subject_bn VARCHAR(160) NOT NULL,
      topic_slug VARCHAR(180) NOT NULL,
      title_en VARCHAR(240) NOT NULL,
      title_bn VARCHAR(240) NOT NULL,
      summary_en TEXT NOT NULL DEFAULT '',
      summary_bn TEXT NOT NULL DEFAULT '',
      content_markdown_en TEXT NOT NULL,
      content_markdown_bn TEXT NOT NULL,
      exam_traps_en JSONB NOT NULL DEFAULT '[]'::jsonb,
      exam_traps_bn JSONB NOT NULL DEFAULT '[]'::jsonb,
      visuals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS revision_topic_question_sets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      topic_id UUID NOT NULL REFERENCES revision_topics(id) ON DELETE CASCADE,
      set_number INTEGER NOT NULL DEFAULT 0,
      set_label VARCHAR(200) NOT NULL,
      generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      generated_by_name VARCHAR(160) NOT NULL DEFAULT 'Admin',
      generated_by_role VARCHAR(32) NOT NULL DEFAULT 'admin',
      question_count INTEGER NOT NULL DEFAULT 30,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS revision_topic_questions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      set_id UUID NOT NULL REFERENCES revision_topic_question_sets(id) ON DELETE CASCADE,
      topic_id UUID NOT NULL REFERENCES revision_topics(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 1,
      stem JSONB NOT NULL,
      options JSONB NOT NULL,
      correct_option VARCHAR(1) NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
      explanation JSONB NOT NULL,
      difficulty VARCHAR(16) NOT NULL DEFAULT 'moderate',
      exam_tag VARCHAR(120) DEFAULT 'WBPSC High-Yield',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS revision_topic_attempts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      topic_id UUID NOT NULL REFERENCES revision_topics(id) ON DELETE CASCADE,
      set_id UUID NOT NULL REFERENCES revision_topic_question_sets(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name VARCHAR(160) NOT NULL,
      total_questions INTEGER NOT NULL DEFAULT 30,
      attempted_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      incorrect_count INTEGER NOT NULL DEFAULT 0,
      net_score NUMERIC(6,2) NOT NULL DEFAULT 0,
      max_score NUMERIC(6,2) NOT NULL DEFAULT 30,
      accuracy_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // Seed default topics (1. Viceroys of India, 2. Sentence Transformations) if empty
  const existingCount = await queryClient<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt FROM revision_topics
  `;
  if (Number(existingCount[0]?.cnt ?? 0) === 0) {
    await seedDefaultRevisionTopics();
  }
}

function buildViceroyQuestions(): Array<{
  stem: BilingualText;
  options: Record<OptionKey, BilingualText>;
  correctOption: OptionKey;
  explanation: BilingualText;
  difficulty: "easy" | "moderate" | "hard";
  examTag: string;
}> {
  const raw: Array<[string, string, [string, string, string, string], [string, string, string, string], OptionKey, string, string, "easy" | "moderate" | "hard", string]> = [
    [
      "Who was the first Viceroy of India appointed under the Government of India Act 1858?",
      "১৮৫৮ সালের ভারত শাসন আইন অনুযায়ী ভারতের প্রথম ভাইসরয় কে নিযুক্ত হন?",
      ["Lord Dalhousie", "Lord Canning", "Lord Elgin I", "Lord Lawrence"],
      ["লর্ড ডালহৌসি", "লর্ড ক্যানিং", "প্রথম লর্ড এলগিন", "লর্ড লরেন্স"],
      "B",
      "Lord Canning (1856–1862) became the last Governor-General under the East India Company and the first Viceroy under the British Crown via the Act of 1858.",
      "লর্ড ক্যানিং (১৮৫৬–১৮৬২) ছিলেন কোম্পানির শেষ গভর্নর-জেনারেল এবং ১৮৫৮ সালের আইনের মাধ্যমে ব্রিটিশ রাজশক্তির অধীনে ভারতের প্রথম ভাইসরয়।",
      "easy",
      "WBCS Prelims PYQ",
    ],
    [
      "Which Viceroy is known as the 'Father of Local Self-Government in India' (1882)?",
      "কোন ভাইসরয়কে 'ভারতে স্থানীয় স্বায়ত্তশাসনের জনক' (১৮৮২) বলা হয়?",
      ["Lord Mayo", "Lord Lytton", "Lord Ripon", "Lord Dufferin"],
      ["লর্ড মেয়ো", "লর্ড লিটন", "লর্ড রিপন", "লর্ড ডাফরিন"],
      "C",
      "Lord Ripon passed the famous Resolution on Local Self-Government in 1882, establishing municipal and district boards across British India.",
      "লর্ড রিপন ১৮৮২ সালে স্থানীয় স্বায়ত্তশাসন প্রস্তাব পাস করেন, যা পৌর ও জেলা বোর্ড গঠনের ভিত্তি স্থাপন করে।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
    [
      "The controversial Ilbert Bill (1883), which sought to allow Indian judges to try European offenders, was introduced during the tenure of:",
      "বিতর্কিত ইলবার্ট বিল (১৮৮৩), যা ভারতীয় বিচারকদের ইউরোপীয় অপরাধীদের বিচার করার ক্ষমতা দিতে চেয়েছিল, কার আমলে পেশ করা হয়?",
      ["Lord Ripon", "Lord Curzon", "Lord Lansdowne", "Lord Lytton"],
      ["লর্ড রিপন", "লর্ড কার্জন", "লর্ড ল্যান্সডাউন", "লর্ড লিটন"],
      "A",
      "Sir Courtenay Ilbert introduced the Ilbert Bill in 1883 during Lord Ripon's viceroyalty.",
      "লর্ড রিপনের ভাইসরয় থাকাকালীন ১৮৮৩ সালে স্যার কোর্টনি ইলবার্ট এই বিলটি পেশ করেন।",
      "easy",
      "WBCS Prelims PYQ",
    ],
    [
      "The Vernacular Press Act (1878), also called the 'Gagging Act', was enacted by which Viceroy?",
      "১৮৭৮ সালের ভার্নাকুলার প্রেস অ্যাক্ট ('গ্যাগিং অ্যাক্ট') কোন ভাইসরয় প্রবর্তন করেন?",
      ["Lord Northbrook", "Lord Lytton", "Lord Ripon", "Lord Elgin II"],
      ["লর্ড নর্থব্রুক", "লর্ড লিটন", "লর্ড রিপন", "দ্বিতীয় লর্ড এলগিন"],
      "B",
      "Lord Lytton enacted the Vernacular Press Act in 1878 to suppress nationalist Indian-language newspapers like Somprakash and Amrita Bazar Patrika.",
      "লর্ড লিটন ১৮৭৮ সালে সোমপ্রকাশ ও অমৃতবাজার পত্রিকার মতো দেশীয় ভাষার সংবাদপত্র দমনের জন্য ভার্নাকুলার প্রেস অ্যাক্ট জারি করেন।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
    [
      "Who repealed the Vernacular Press Act in 1882?",
      "১৮৮২ সালে ভার্নাকুলার প্রেস অ্যাক্ট কে রদ করেন?",
      ["Lord Dufferin", "Lord Ripon", "Lord Curzon", "Lord Minto II"],
      ["লর্ড ডাফরিন", "লর্ড রিপন", "লর্ড কার্জন", "দ্বিতীয় লর্ড মিন্টো"],
      "B",
      "Lord Ripon repealed the Vernacular Press Act in 1882, restoring freedom to Indian-language newspapers.",
      "লর্ড রিপন ১৮৮২ সালে ভার্নাকুলার প্রেস অ্যাক্ট রদ করে দেশীয় সংবাদপত্রের স্বাধীনতা ফিরিয়ে দেন।",
      "easy",
      "WBPSC Food SI PYQ",
    ],
    [
      "The first census in India (non-synchronous, 1872) was conducted during the period of which Viceroy?",
      "ভারতে প্রথম জনগণনা (১৮৭২ সালে অসমলয়) কোন ভাইসরয়ের আমলে অনুষ্ঠিত হয়?",
      ["Lord Mayo", "Lord Ripon", "Lord Lytton", "Lord Lawrence"],
      ["লর্ড মেয়ো", "লর্ড রিপন", "লর্ড লিটন", "লর্ড লরেন্স"],
      "A",
      "The first census of India took place in 1872 under Lord Mayo, while the first synchronous decennial census was held in 1881 under Lord Ripon.",
      "ভারতে প্রথম জনগণনা ১৮৭২ সালে লর্ড মেয়োর আমলে হয় এবং প্রথম নিয়মিত দশবার্ষিকী জনগণনা ১৮৮১ সালে লর্ড রিপনের আমলে শুরু হয়।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "Which Viceroy was assassinated by Sher Ali Afridi at Port Blair (Andaman) in 1872?",
      "১৮৭২ সালে আন্দামানের পোর্ট ব্লেয়ারে শের আলী আফ্রিদির হাতে কোন ভাইসরয় নিহত হন?",
      ["Lord Lawrence", "Lord Mayo", "Lord Northbrook", "Lord Hardinge II"],
      ["লর্ড লরেন্স", "লর্ড মেয়ো", "লর্ড নর্থব্রুক", "দ্বিতীয় লর্ড হার্ডিঞ্জ"],
      "B",
      "Lord Mayo was the only Viceroy of India to be assassinated in office, stabbed at Port Blair in 1872.",
      "লর্ড মেয়ো ছিলেন কর্মরত অবস্থায় নিহত ভারতের একমাত্র ভাইসরয়, যিনি ১৮৭২ সালে পোর্ট ব্লেয়ারে নিহত হন।",
      "moderate",
      "WBPSC Clerkship PYQ",
    ],
    [
      "The Partition of Bengal (16 October 1905) was carried out by which Viceroy?",
      "বঙ্গভঙ্গ (১৬ অক্টোবর ১৯০৫) কোন ভাইসরয়ের দ্বারা কার্যকর হয়েছিল?",
      ["Lord Minto II", "Lord Curzon", "Lord Hardinge II", "Lord Elgin II"],
      ["দ্বিতীয় লর্ড মিন্টো", "লর্ড কার্জন", "দ্বিতীয় লর্ড হার্ডিঞ্জ", "দ্বিতীয় লর্ড এলগিন"],
      "B",
      "Lord Curzon announced the Partition of Bengal in July 1905 and implemented it on 16 October 1905.",
      "লর্ড কার্জন ১৯০৫ সালের জুলাই মাসে বঙ্গভঙ্গের ঘোষণা করেন এবং ১৬ অক্টোবর ১৯০৫ তা কার্যকর হয়।",
      "easy",
      "WBCS Prelims PYQ",
    ],
    [
      "The Indian National Congress was founded in December 1885 during the viceroyalty of:",
      "১৮৮৫ সালের ডিসেম্বরে কোন ভাইসরয়ের আমলে ভারতীয় জাতীয় কংগ্রেস প্রতিষ্ঠিত হয়?",
      ["Lord Ripon", "Lord Dufferin", "Lord Lansdowne", "Lord Curzon"],
      ["লর্ড রিপন", "লর্ড ডাফরিন", "লর্ড ল্যান্সডাউন", "লর্ড কার্জন"],
      "B",
      "Lord Dufferin (1884–1888) was the Viceroy when A.O. Hume founded the Indian National Congress in Bombay in 1885.",
      "১৮৮৫ সালে বোম্বাইতে এ. ও. হিউম যখন ভারতীয় জাতীয় কংগ্রেস প্রতিষ্ঠা করেন, তখন লর্ড ডাফরিন (১৮৮৪–১৮৮৮) ভাইসরয় ছিলেন।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
    [
      "Which Viceroy described the Indian National Congress as representing only a 'microscopic minority'?",
      "কোন ভাইসরয় ভারতীয় জাতীয় কংগ্রেসকে একটি 'আণুবীক্ষণিক সংখ্যালঘু' (microscopic minority)-র প্রতিনিধি বলে ব্যঙ্গ করেছিলেন?",
      ["Lord Curzon", "Lord Dufferin", "Lord Lytton", "Lord Minto II"],
      ["লর্ড কার্জন", "লর্ড ডাফরিন", "লর্ড লিটন", "দ্বিতীয় লর্ড মিন্টো"],
      "B",
      "Lord Dufferin called the Congress a 'microscopic minority' in 1888.",
      "লর্ড ডাফরিন ১৮৮৮ সালে কংগ্রেসকে 'আণুবীক্ষণিক সংখ্যালঘু' বলে অভিহিত করেছিলেন।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "The Ancient Monuments Preservation Act (1904) and the Indian Universities Act (1904) were passed under:",
      "প্রাচীন সৌধ সংরক্ষণ আইন (১৯০৪) এবং ভারতীয় বিশ্ববিদ্যালয় আইন (১৯০৪) কার আমলে পাস হয়?",
      ["Lord Ripon", "Lord Curzon", "Lord Chelmsford", "Lord Reading"],
      ["লর্ড রিপন", "লর্ড কার্জন", "লর্ড চেমসফোর্ড", "লর্ড রিডিং"],
      "B",
      "Lord Curzon passed both the Indian Universities Act (based on the Raleigh Commission) and the Ancient Monuments Preservation Act in 1904.",
      "লর্ড কার্জন ১৯০৪ সালে র‍্যালে কমিশনের সুপারিশে ভারতীয় বিশ্ববিদ্যালয় আইন এবং প্রাচীন সৌধ সংরক্ষণ আইন পাস করেন।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "During whose tenure was the capital of British India shifted from Calcutta to Delhi (announced at the 1911 Delhi Durbar)?",
      "কার আমলে ব্রিটিশ ভারতের রাজধানী কলকাতা থেকে দিল্লিতে স্থানান্তরিত হয় (১৯১১ সালের দিল্লি দরবারে ঘোষিত)?",
      ["Lord Minto II", "Lord Hardinge II", "Lord Chelmsford", "Lord Curzon"],
      ["দ্বিতীয় লর্ড মিন্টো", "দ্বিতীয় লর্ড হার্ডিঞ্জ", "লর্ড চেমসফোর্ড", "লর্ড কার্জন"],
      "B",
      "Lord Hardinge II (1910–1916) hosted the 1911 Delhi Durbar for King George V, where the annulment of the Partition of Bengal and the shift of capital to Delhi were announced.",
      "দ্বিতীয় লর্ড হার্ডিঞ্জের (১৯১০–১৯১৬) আমলে ১৯১১ সালের দিল্লি দরবারে বঙ্গভঙ্গ রদ এবং কলকাতা থেকে দিল্লিতে রাজধানী স্থানান্তরের ঘোষণা হয়।",
      "easy",
      "WBPSC High-Yield",
    ],
    [
      "The Morley-Minto Reforms (Indian Councils Act 1909), which introduced separate electorates for Muslims, were enacted during the tenure of:",
      "মর্লে-মিন্টো সংস্কার (১৯০৯ সালের ভারতীয় কাউন্সিল আইন), যা মুসলিমদের জন্য পৃথক নির্বাচকমণ্ডলী চালু করে, কার আমলে প্রণীত হয়?",
      ["Lord Curzon", "Lord Minto II", "Lord Hardinge II", "Lord Chelmsford"],
      ["লর্ড কার্জন", "দ্বিতীয় লর্ড মিন্টো", "দ্বিতীয় লর্ড হার্ডিঞ্জ", "লর্ড চেমসফোর্ড"],
      "B",
      "Lord Minto II was the Viceroy and John Morley was the Secretary of State when the Indian Councils Act 1909 introduced communal electorates.",
      "১৯০৯ সালের আইনে সাম্প্রদায়িক নির্বাচন ব্যবস্থা চালুর সময় দ্বিতীয় লর্ড মিন্টো ছিলেন ভাইসরয় এবং জন মর্লে ছিলেন ভারত সচিব।",
      "easy",
      "WBCS Prelims PYQ",
    ],
    [
      "The Rowlatt Act (1919) and the Jallianwala Bagh Massacre (13 April 1919) took place during the viceroyalty of:",
      "রাওলাট আইন (১৯১৯) এবং জালিয়ানওয়ালাবাগ হত্যাকাণ্ড (১৩ এপ্রিল ১৯১৯) কোন ভাইসরয়ের আমলে ঘটেছিল?",
      ["Lord Hardinge II", "Lord Chelmsford", "Lord Reading", "Lord Irwin"],
      ["দ্বিতীয় লর্ড হার্ডিঞ্জ", "লর্ড চেমসফোর্ড", "লর্ড রিডিং", "লর্ড আরউইন"],
      "B",
      "Lord Chelmsford (1916–1921) was the Viceroy during the Rowlatt Act, Jallianwala Bagh tragedy, Khilafat Movement, and launch of Non-Cooperation.",
      "লর্ড চেমসফোর্ড (১৯১৬–১৯২১) রাওলাট আইন, জালিয়ানওয়ালাবাগ হত্যাকাণ্ড এবং অসহযোগ আন্দোলনের সূচনাকালে ভাইসরয় ছিলেন।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
    [
      "Which reform introduced 'Dyarchy' (dual government) in the provinces in 1919?",
      "১৯১৯ সালে প্রদেশগুলিতে 'দ্বৈত শাসন' (Dyarchy) কোন সংস্কারের মাধ্যমে চালু হয়?",
      ["Morley-Minto Reforms", "Montagu-Chelmsford Reforms", "Simon Commission Report", "Cripps Mission"],
      ["মর্লে-মিন্টো সংস্কার", "মন্টেগু-চেমসফোর্ড সংস্কার", "সাইমন কমিশন রিপোর্ট", "ক্রিপস মিশন"],
      "B",
      "The Government of India Act 1919 (Montagu-Chelmsford Reforms) introduced Dyarchy in provinces, dividing subjects into Reserved and Transferred.",
      "১৯১৯ সালের মন্টেগু-চেমসফোর্ড সংস্কার প্রদেশগুলিতে সংরক্ষিত ও হস্তান্তরিত বিষয়ের মাধ্যমে দ্বৈত শাসন চালু করে।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "The Chauri Chaura incident (February 1922) and the Kakori Train Robbery (1925) occurred during the tenure of which Viceroy?",
      "চৌরি চৌরা ঘটনা (ফেব্রুয়ারি ১৯২২) এবং কাকোরি ট্রেন ডাকাতি (১৯২৫) কোন ভাইসরয়ের আমলে ঘটেছিল?",
      ["Lord Chelmsford", "Lord Reading", "Lord Irwin", "Lord Willingdon"],
      ["লর্ড চেমসফোর্ড", "লর্ড রিডিং", "লর্ড আরউইন", "লর্ড উইলিংডন"],
      "B",
      "Lord Reading (1921–1926), the only Jewish Viceroy of India, served during the Chauri Chaura incident, formation of the Swaraj Party (1923), and Kakori conspiracy (1925).",
      "লর্ড রিডিংয়ের (১৯২১–১৯২৬) আমলে চৌরি চৌরা ঘটনা, স্বরাজ্য দল গঠন (১৯২৩) এবং কাকোরি ষড়যন্ত্র (১৯২৫) ঘটেছিল।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "The Simon Commission arrived in India in February 1928 during the viceroyalty of:",
      "১৯২৮ সালের ফেব্রুয়ারিতে সাইমন কমিশন কোন ভাইসরয়ের আমলে ভারতে আসে?",
      ["Lord Reading", "Lord Irwin", "Lord Willingdon", "Lord Linlithgow"],
      ["লর্ড রিডিং", "লর্ড আরউইন", "লর্ড উইলিংডন", "লর্ড লিনলিথগো"],
      "B",
      "Lord Irwin (1926–1931) was the Viceroy during the arrival of the Simon Commission (1928), Dandi March (1930), and First Round Table Conference.",
      "সাইমন কমিশনের আগমন (১৯২৮), ডান্ডি অভিযান (১৯৩০) এবং প্রথম গোলটেবিল বৈঠকের সময় লর্ড আরউইন (১৯২৬–১৯৩১) ভাইসরয় ছিলেন।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
    [
      "Which Viceroy made the 'Deepavali Declaration' on 31 October 1929 promising 'Dominion Status' as the natural issue of India's constitutional progress?",
      "কোন ভাইসরয় ১৯২৯ সালের ৩১ অক্টোবর ভারতের সাংবিধানিক অগ্রগতির লক্ষ্য হিসেবে 'ডোমিনিয়ন স্ট্যাটাস'-এর প্রতিশ্রুতি দিয়ে 'দীপাবলি ঘোষণা' করেন?",
      ["Lord Reading", "Lord Irwin", "Lord Willingdon", "Lord Wavell"],
      ["লর্ড রিডিং", "লর্ড আরউইন", "লর্ড উইলিংডন", "লর্ড ওয়াভেল"],
      "B",
      "Lord Irwin issued the Irwin Declaration (Deepavali Declaration) on 31 October 1929 affirming Dominion Status as the goal.",
      "লর্ড আরউইন ১৯২৯ সালের ৩১ অক্টোবর ডোমিনিয়ন স্ট্যাটাসের প্রতিশ্রুতি দিয়ে ঐতিহাসিক দীপাবলি ঘোষণা প্রকাশ করেন।",
      "hard",
      "WBCS Prelims PYQ",
    ],
    [
      "The Gandhi-Irwin Pact was signed on 5 March 1931 just before which session of the Indian National Congress?",
      "১৯৩১ সালের ৫ মার্চ গান্ধী-আরউইন চুক্তি জাতীয় কংগ্রেসের কোন অধিবেশনের ঠিক আগে স্বাক্ষরিত হয়েছিল?",
      ["Lahore Session (1929)", "Karachi Session (1931)", "Tripuri Session (1939)", "Haripura Session (1938)"],
      ["লাহোর অধিবেশন (১৯২৯)", "করাচি অধিবেশন (১৯৩১)", "ত্রিপুরী অধিবেশন (১৯৩৯)", "হরিপুরা অধিবেশন (১৯৩৮)"],
      "B",
      "The Gandhi-Irwin Pact was signed on 5 March 1931 and endorsed at the Karachi Session of the Congress presided over by Sardar Vallabhbhai Patel later that month.",
      "১৯৩১ সালের ৫ মার্চ গান্ধী-আরউইন চুক্তি স্বাক্ষরিত হয় এবং ওই মাসেই সর্দার বল্লভভাই প্যাটেলের সভাপতিত্বে করাচি অধিবেশনে তা অনুমোদিত হয়।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "The Second and Third Round Table Conferences and the Communal Award (1932) took place during the tenure of:",
      "দ্বিতীয় ও তৃতীয় গোলটেবিল বৈঠক এবং সাম্প্রদায়িক বাঁটোয়ারা (১৯৩২) কার আমলে অনুষ্ঠিত হয়?",
      ["Lord Irwin", "Lord Willingdon", "Lord Linlithgow", "Lord Wavell"],
      ["লর্ড আরউইন", "লর্ড উইলিংডন", "লর্ড লিনলিথগো", "লর্ড ওয়াভেল"],
      "B",
      "Lord Willingdon (1931–1936) was the Viceroy during the Second & Third Round Table Conferences, Ramsay MacDonald's Communal Award (1932), Poona Pact (1932), and Government of India Act 1935.",
      "লর্ড উইলিংডনের (১৯৩১–১৯৩৬) আমলে দ্বিতীয় ও তৃতীয় গোলটেবিল বৈঠক, সাম্প্রদায়িক বাঁটোয়ারা, পুনা চুক্তি (১৯৩২) এবং ১৯৩৫ সালের ভারত শাসন আইন পাস হয়।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "Who was the longest-serving Viceroy of India (1936–1943), under whom the Quit India Movement (1942) took place?",
      "ভারতের দীর্ঘতম মেয়াদের ভাইসরয় (১৯৩৬–১৯৪৩) কে ছিলেন, যাঁর আমলে ভারত ছাড়ো আন্দোলন (১৯৪২) সংঘটিত হয়?",
      ["Lord Curzon", "Lord Linlithgow", "Lord Wavell", "Lord Willingdon"],
      ["লর্ড কার্জন", "লর্ড লিনলিথগো", "লর্ড ওয়াভেল", "লর্ড উইলিংডন"],
      "B",
      "Lord Linlithgow served from 1936 to 1943 (7.5 years), the longest tenure among all Viceroys. Key events include the 1937 provincial elections, August Offer (1940), Cripps Mission (1942), and Quit India Movement (1942).",
      "লর্ড লিনলিথগো ১৯৩৬ থেকে ১৯৪৩ পর্যন্ত দীর্ঘতম সময় ভাইসরয় ছিলেন। তাঁর আমলেই আগস্ট প্রস্তাব (১৯৪০), ক্রিপস মিশন ও ভারত ছাড়ো আন্দোলন (১৯৪২) হয়।",
      "easy",
      "WBPSC High-Yield",
    ],
    [
      "The 'August Offer' of 1940 was announced by which Viceroy?",
      "১৯৪০ সালের 'আগস্ট প্রস্তাব' কোন ভাইসরয় ঘোষণা করেছিলেন?",
      ["Lord Willingdon", "Lord Linlithgow", "Lord Wavell", "Lord Mountbatten"],
      ["লর্ড উইলিংডন", "লর্ড লিনলিথগো", "লর্ড ওয়াভেল", "লর্ড মাউন্টব্যাটেন"],
      "B",
      "Lord Linlithgow announced the August Offer on 8 August 1940 proposing a constituent assembly after World War II.",
      "দ্বিতীয় বিশ্বযুদ্ধের পর গণপরিষদ গঠনের প্রস্তাব দিয়ে লর্ড লিনলিথগো ১৯৪০ সালের ৮ আগস্ট 'আগস্ট প্রস্তাব' ঘোষণা করেন।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "The Simla Conference (June 1945) and the Cabinet Mission (1946) occurred during the viceroyalty of:",
      "সিমলা সম্মেলন (জুন ১৯৪৫) এবং ক্যাবিনেট মিশন (১৯৪৬) কোন ভাইসরয়ের আমলে অনুষ্ঠিত হয়?",
      ["Lord Linlithgow", "Lord Wavell", "Lord Mountbatten", "Lord Irwin"],
      ["লর্ড লিনলিথগো", "লর্ড ওয়াভেল", "লর্ড মাউন্টব্যাটেন", "লর্ড আরউইন"],
      "B",
      "Lord Wavell (1943–1947) convened the Simla Conference in 1945 (Wavell Plan) and received the Cabinet Mission in 1946.",
      "লর্ড ওয়াভেল (১৯৪৩–১৯৪৭) ১৯৪৫ সালে ওয়াভেল পরিকল্পনা নিয়ে সিমলা সম্মেলন আহ্বান করেন এবং ১৯৪৬ সালে তাঁর আমলেই ক্যাবিনেট মিশন ভারতে আসে।",
      "easy",
      "WBCS Prelims PYQ",
    ],
    [
      "Who was the last British Viceroy of India and the first Governor-General of independent India?",
      "পরাধীন ভারতের শেষ ব্রিটিশ ভাইসরয় এবং স্বাধীন ভারতের প্রথম গভর্নর-জেনারেল কে ছিলেন?",
      ["Lord Wavell", "Lord Mountbatten", "C. Rajagopalachari", "Lord Linlithgow"],
      ["লর্ড ওয়াভেল", "লর্ড মাউন্টব্যাটেন", "সি. রাজাগোপালাচারী", "লর্ড লিনলিথগো"],
      "B",
      "Lord Mountbatten served as the last Viceroy of British India (March–August 1947) and the first Governor-General of the Dominion of India (August 1947–June 1948).",
      "লর্ড মাউন্টব্যাটেন ছিলেন ব্রিটিশ ভারতের শেষ ভাইসরয় এবং স্বাধীন ভারতের প্রথম গভর্নর-জেনারেল।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
    [
      "Who was the first and last Indian Governor-General of independent India?",
      "স্বাধীন ভারতের প্রথম ও শেষ ভারতীয় গভর্নর-জেনারেল কে ছিলেন?",
      ["Dr. Rajendra Prasad", "C. Rajagopalachari", "Sardar Vallabhbhai Patel", "Jawaharlal Nehru"],
      ["ড. রাজেন্দ্র প্রসাদ", "চক্রবর্তী রাজাগোপালাচারী", "সর্দার বল্লভভাই প্যাটেল", "জওহরলাল নেহরু"],
      "B",
      "Chakravarti Rajagopalachari ('Rajaji') succeeded Lord Mountbatten in June 1948 and served until 26 January 1950.",
      "চক্রবর্তী রাজাগোপালাচারী ১৯৪৮ সালের জুন মাসে লর্ড মাউন্টব্যাটেনের স্থলাভিষিক্ত হন এবং ২৬ জানুয়ারি ১৯৫০ পর্যন্ত ভারতের একমাত্র ভারতীয় গভর্নর-জেনারেল হিসেবে দায়িত্ব পালন করেন।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
    [
      "The 'Portfolio System' in the Executive Council was legally recognized by the Indian Councils Act 1861 during the tenure of:",
      "১৮৬১ সালের ইন্ডিয়ান কাউন্সিল অ্যাক্টের মাধ্যমে কার্যনির্বাহী পরিষদে 'পোর্টফোলিও ব্যবস্থা' কার আমলে আইনি স্বীকৃতি পায়?",
      ["Lord Dalhousie", "Lord Canning", "Lord Lawrence", "Lord Mayo"],
      ["লর্ড ডালহৌসি", "লর্ড ক্যানিং", "লর্ড লরেন্স", "লর্ড মেয়ো"],
      "B",
      "Lord Canning introduced the Portfolio System in 1859, which was given statutory recognition by the Indian Councils Act of 1861.",
      "লর্ড ক্যানিং প্রবর্তিত পোর্টফোলিও ব্যবস্থা ১৮৬১ সালের ইন্ডিয়ান কাউন্সিল অ্যাক্টের মাধ্যমে আইনি স্বীকৃতি লাভ করে।",
      "moderate",
      "WBCS Prelims PYQ",
    ],
    [
      "The High Courts at Calcutta, Bombay, and Madras were established in 1862 under the Indian High Courts Act 1861 during the tenure of:",
      "কলকাতা, বোম্বাই ও মাদ্রাজ হাইকোর্ট ১৮৬২ সালে কোন ভাইসরয়ের আমলে প্রতিষ্ঠিত হয়?",
      ["Lord Canning / Lord Elgin I", "Lord Ripon", "Lord Curzon", "Lord Lytton"],
      ["লর্ড ক্যানিং / প্রথম লর্ড এলগিন", "লর্ড রিপন", "লর্ড কার্জন", "লর্ড লিটন"],
      "A",
      "The Indian High Courts Act was passed in 1861 under Lord Canning, and the Calcutta High Court formally opened in July 1862.",
      "১৮৬১ সালে লর্ড ক্যানিংয়ের আমলে ইন্ডিয়ান হাইকোর্টস অ্যাক্ট পাস হয় এবং ১৮৬২ সালের জুলাই মাসে কলকাতা হাইকোর্ট স্থাপিত হয়।",
      "moderate",
      "WBPSC High-Yield",
    ],
    [
      "The Durand Commission (1893) to demarcate the boundary line between British India and Afghanistan was set up during the tenure of:",
      "ব্রিটিশ ভারত ও আফগানিস্তানের মধ্যে সীমানা নির্ধারণের জন্য ডুরান্ড কমিশন (১৮৯৩) কার আমলে গঠিত হয়?",
      ["Lord Dufferin", "Lord Lansdowne", "Lord Elgin II", "Lord Curzon"],
      ["লর্ড ডাফরিন", "লর্ড ল্যান্সডাউন", "দ্বিতীয় লর্ড এলগিন", "লর্ড কার্জন"],
      "B",
      "Lord Lansdowne (1888–1894) appointed Sir Mortimer Durand in 1893 to demarcate the Indo-Afghan border (Durand Line).",
      "লর্ড ল্যান্সডাউন (১৮৮৮–১৮৯৪) ১৮৯৩ সালে ভারত-আফগান সীমান্ত (ডুরান্ড লাইন) নির্ধারণের জন্য ডুরান্ড কমিশন গঠন করেন।",
      "hard",
      "WBCS Prelims PYQ",
    ],
    [
      "Which Viceroy followed the policy of 'Masterly Inactivity' towards Afghanistan?",
      "আফগানিস্তানের প্রতি 'নৈপুণ্যপূর্ণ নিষ্ক্রিয়তা' (Masterly Inactivity) নীতি কোন ভাইসরয় অনুসরণ করেছিলেন?",
      ["Lord Lytton", "Lord John Lawrence", "Lord Auckland", "Lord Curzon"],
      ["লর্ড লিটন", "লর্ড জন লরেন্স", "লর্ড অকল্যান্ড", "লর্ড কার্জন"],
      "B",
      "Sir John Lawrence (1864–1869) followed the policy of 'Masterly Inactivity' (non-intervention) in Afghan affairs, whereas Lord Lytton later pursued the 'Proud Reserve' / Forward Policy.",
      "স্যার জন লরেন্স (১৮৬৪–১৮৬৯) আফগানিস্তানের ক্ষেত্রে 'নৈপুণ্যপূর্ণ নিষ্ক্রিয়তা' নীতি অনুসরণ করেছিলেন।",
      "hard",
      "WBCS Prelims PYQ",
    ],
    [
      "The First Factory Act (1881) to regulate child labour in Indian factories was passed during the tenure of:",
      "ভারতীয় কারখানায় শিশুশ্রম নিয়ন্ত্রণের জন্য প্রথম ফ্যাক্টরি আইন (১৮৮১) কার আমলে পাস হয়?",
      ["Lord Lytton", "Lord Ripon", "Lord Lansdowne", "Lord Curzon"],
      ["লর্ড লিটন", "লর্ড রিপন", "লর্ড ল্যান্সডাউন", "লর্ড কার্জন"],
      "B",
      "Lord Ripon passed the First Factory Act in 1881 prohibiting employment of children under age 7 and limiting working hours for children aged 7–12.",
      "লর্ড রিপন ১৮৮১ সালে প্রথম ফ্যাক্টরি আইন পাস করেন, যা ৭ বছরের কম বয়সী শিশুদের কারখানায় নিয়োগ নিষিদ্ধ করে।",
      "easy",
      "WBPSC Clerkship PYQ",
    ],
  ];

  return raw.map(([stemEn, stemBn, optsEn, optsBn, correctOption, expEn, expBn, difficulty, examTag]) => ({
    stem: { en: stemEn, bn: stemBn },
    options: {
      A: { en: optsEn[0], bn: optsBn[0] },
      B: { en: optsEn[1], bn: optsBn[1] },
      C: { en: optsEn[2], bn: optsBn[2] },
      D: { en: optsEn[3], bn: optsBn[3] },
    },
    correctOption,
    explanation: { en: expEn, bn: expBn },
    difficulty,
    examTag,
  }));
}

function buildSentenceTransformationQuestions(): Array<{
  stem: BilingualText;
  options: Record<OptionKey, BilingualText>;
  correctOption: OptionKey;
  explanation: BilingualText;
  difficulty: "easy" | "moderate" | "hard";
  examTag: string;
}> {
  const raw: Array<[string, string, [string, string, string, string], OptionKey, string, string, "easy" | "moderate" | "hard", string]> = [
    [
      "Transform into a Complex sentence: 'He is too weak to walk.'",
      "Complex বাক্যে রূপান্তর করুন: 'He is too weak to walk.'",
      [
        "He is very weak and cannot walk.",
        "He is so weak that he cannot walk.",
        "Being weak, he cannot walk.",
        "He cannot walk because of his weakness.",
      ],
      "B",
      "Rule: 'too ... to' in a Simple sentence transforms into 'so ... that + subject + cannot/could not' in a Complex sentence.",
      "নিয়ম: Simple বাক্যের 'too + adj + to + verb' কে Complex করতে হলে 'so + adj + that + sub + cannot/could not + verb' ব্যবহার করতে হয়।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Transform into a Simple sentence: 'Although he was poor, he was honest.'",
      "Simple বাক্যে রূপান্তর করুন: 'Although he was poor, he was honest.'",
      [
        "He was poor but honest.",
        "In spite of his poverty, he was honest.",
        "He was poor and honest.",
        "Because of poverty, he was honest.",
      ],
      "B",
      "Rule: 'Although / Though' (Complex) transforms into 'In spite of / Despite + possessive + noun/gerund' in a Simple sentence.",
      "নিয়ম: 'Although/Though' যুক্ত Complex বাক্যকে Simple করতে 'In spite of / Despite + সম্বন্ধপদ/বিশেষ্য (his poverty)' ব্যবহৃত হয়।",
      "easy",
      "WBCS Prelims English PYQ",
    ],
    [
      "Transform into a Compound sentence: 'Seeing the police, the thief ran away.'",
      "Compound বাক্যে রূপান্তর করুন: 'Seeing the police, the thief ran away.'",
      [
        "When the thief saw the police, he ran away.",
        "The thief saw the police and ran away.",
        "As soon as the thief saw the police, he ran away.",
        "The thief ran away because he saw the police.",
      ],
      "B",
      "Rule: Present participle ('Seeing...') in a Simple sentence becomes two coordinate main clauses joined by 'and' in a Compound sentence.",
      "নিয়ম: Simple বাক্যকে Compound করতে দুটি স্বাধীন বাক্যাংশকে 'and' সংযোজক দ্বারা যুক্ত করা হয়।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Transform into an Interrogative sentence without changing the meaning: 'No one can tolerate such an insult.'",
      "অর্থ পরিবর্তন না করে Interrogative বাক্যে রূপান্তর করুন: 'No one can tolerate such an insult.'",
      [
        "Can anyone tolerate such an insult?",
        "Who cannot tolerate such an insult?",
        "Can no one tolerate such an insult?",
        "Why can anyone tolerate such an insult?",
      ],
      "A",
      "Rule: 'No one / Nobody' in a negative assertive sentence becomes 'Can anyone...?' or 'Who can...?' in an interrogative sentence.",
      "নিয়ম: 'No one' যুক্ত নঞর্থক বাক্যকে প্রশ্নবোধক করতে 'Can anyone...?' বা 'Who can...?' ব্যবহৃত হয়।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Transform into an Assertive sentence: 'What a wonderful piece of art this is!'",
      "Assertive বাক্যে রূপান্তর করুন: 'What a wonderful piece of art this is!'",
      [
        "This is a wonderful piece of art.",
        "This is a very wonderful piece of art.",
        "This is truly a great piece of art.",
        "It is a piece of art.",
      ],
      "C",
      "Rule: Exclamatory 'What a/an + adjective' transforms into 'very / truly / great' in an Assertive sentence (since 'wonderful' already implies extreme degree, 'truly a great / a very fine' is standard).",
      "নিয়ম: Exclamatory বাক্যকে Assertive করার সময় আবেগসূচক 'What a' উঠে গিয়ে 'very / truly / great' বসে।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Transform into a Negative sentence without changing meaning: 'Every mother loves her child.'",
      "অর্থ অপরিবর্তিত রেখে Negative বাক্যে রূপান্তর করুন: 'Every mother loves her child.'",
      [
        "No mother hates her child.",
        "There is no mother but loves her child.",
        "Every mother does not hate her child.",
        "Not a single mother loves her child.",
      ],
      "B",
      "Rule: 'Every + noun + verb' transforms into 'There is no + noun + but + verb' (or 'There is no mother who does not love her child').",
      "নিয়ম: 'Every + noun' যুক্ত বাক্যকে অর্থ না বদলে Negative করতে 'There is no + noun + but + verb' ব্যবহৃত হয়।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Change from Affirmative to Negative: 'As soon as the teacher entered, the students stood up.'",
      "Affirmative থেকে Negative করুন: 'As soon as the teacher entered, the students stood up.'",
      [
        "No sooner had the teacher entered than the students stood up.",
        "No sooner did the teacher entered when the students stood up.",
        "Hardly had the teacher entered than the students stood up.",
        "Scarcely the teacher entered when the students stood up.",
      ],
      "A",
      "Rule: 'As soon as + past' transforms into 'No sooner had + subject + V3 ... than + past clause' (Note: 'No sooner' always pairs with 'than', while 'Hardly/Scarcely' pairs with 'when').",
      "নিয়ম: 'As soon as' থাকলে Negative করতে 'No sooner had + sub + V3 ... than' বসে। ('Hardly/Scarcely'-র সাথে 'when' বসে, 'than' নয়)।",
      "easy",
      "WBPSC High-Yield Trap",
    ],
    [
      "Change to Positive Degree: 'Iron is more useful than any other metal.'",
      "Positive Degree-তে রূপান্তর করুন: 'Iron is more useful than any other metal.'",
      [
        "No other metal is as useful as iron.",
        "Very few metals are as useful as iron.",
        "All metals are as useful as iron.",
        "Iron is as useful as other metals.",
      ],
      "A",
      "Rule: Comparative with 'than any other' (singular) converts to Positive Degree starting with 'No other + singular noun + is as ... as'.",
      "নিয়ম: Comparative বাক্যে 'than any other' থাকলে Positive Degree শুরু হয় 'No other + একবচন বিশেষ্য + is as ... as' দিয়ে।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Change to Comparative Degree: ' Ashoka was one of the greatest kings of India.'",
      "Comparative Degree-তে রূপান্তর করুন: 'Ashoka was one of the greatest kings of India.'",
      [
        "Ashoka was greater than any other king of India.",
        "Ashoka was greater than most other kings of India.",
        "No other king was greater than Ashoka.",
        "Ashoka was more great than other kings.",
      ],
      "B",
      "Rule: 'One of the + superlative' converts to 'Comparative + than most other + plural noun' (and 'Very few...' in Positive degree).",
      "নিয়ম: 'One of the + superlative' থাকলে Comparative করতে 'than most other + বহুবচন বিশেষ্য' বসে।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Change the Voice: 'Who taught you Bengali?'",
      "বাচ্য পরিবর্তন (Voice Change) করুন: 'Who taught you Bengali?'",
      [
        "By whom were you taught Bengali?",
        "Who was taught Bengali by you?",
        "By whom you were taught Bengali?",
        "Whom were you taught Bengali by?",
      ],
      "A",
      "Rule: Active 'Who + past verb + object' becomes 'By whom + was/were + subject + V3?' (Note interrogative inversion: 'were you', not 'you were').",
      "নিয়ম: 'Who' দিয়ে শুরু হওয়া প্রশ্নবোধক বাক্যের Passive করতে 'By whom + সাহায্যকারী ক্রিয়া (were) + কর্তা (you) + V3?' বসে।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Change the Voice: 'Honey tastes sweet.' (Quasi-Passive)",
      "Voice Change করুন: 'Honey tastes sweet.'",
      [
        "Sweet is tasted by honey.",
        "Honey is sweet when it is tasted.",
        "Honey is being tasted sweet.",
        "Let honey be tasted sweet.",
      ],
      "B",
      "Rule: Quasi-passive verbs with a complement ('Subject + verb + adjective') become 'Subject + is/was + adjective + when it is/was + V3'.",
      "নিয়ম: কমপ্লিমেন্ট যুক্ত Quasi-passive বাক্যের ক্ষেত্রে গঠন হয়: 'Subject + is + adjective + when it is + V3'।",
      "easy",
      "WBPSC Food SI PYQ",
    ],
    [
      "Change the Voice: 'Do not insult the weak.'",
      "Voice Change করুন: 'Do not insult the weak.'",
      [
        "Let the weak not be insulted.",
        "The weak are not insulted.",
        "Do not let the weak insulted.",
        "The weak should not insult.",
      ],
      "A",
      "Rule: Negative imperative 'Do not + V1 + object' becomes 'Let + object + not be + V3' (or 'You are forbidden to...').",
      "নিয়ম: 'Do not' যুক্ত আদেশসূচক বাক্যের Passive রূপ হলো 'Let + object + not be + V3'।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Transform into a Complex sentence: 'Tell me the time of his arrival.'",
      "Complex বাক্যে রূপান্তর করুন: 'Tell me the time of his arrival.'",
      [
        "Tell me when he will arrive.",
        "He will arrive and tell me the time.",
        "Tell me the time and he will arrive.",
        "Asking the time of his arrival.",
      ],
      "A",
      "Rule: Expanding the noun phrase 'the time of his arrival' into a subordinate clause 'when he will arrive' creates a Complex sentence.",
      "নিয়ম: 'the time of his arrival' শব্দগুচ্ছটিকে 'when he will arrive' অপ্রধান খণ্ডবাক্যে সম্প্রসারিত করে Complex বাক্য গঠিত হয়।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Transform into a Simple sentence: 'He must work hard or he will fail.'",
      "Simple বাক্যে রূপান্তর করুন: 'He must work hard or he will fail.'",
      [
        "Unless he works hard, he will fail.",
        "Without working hard, he will fail.",
        "If he does not work hard, he will fail.",
        "He works hard so that he does not fail.",
      ],
      "B",
      "Rule: Compound 'must ... or' transforms into Simple using 'Without + gerund (working hard)' or 'In the event of not...'. ('Unless...' and 'If...' are Complex sentences).",
      "নিয়ম: 'or' যুক্ত Compound বাক্যকে Simple করতে 'Without + gerund (-ing)' ব্যবহৃত হয় ('Unless' বা 'If' দিলে তা Complex হয়ে যাবে)।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Transform into a Compound sentence: 'If you do not hurry, you will miss the train.'",
      "Compound বাক্যে রূপান্তর করুন: 'If you do not hurry, you will miss the train.'",
      [
        "Hurry up, or you will miss the train.",
        "Without hurrying, you will miss the train.",
        "Unless you hurry, you will miss the train.",
        "Being late, you will miss the train.",
      ],
      "A",
      "Rule: Negative condition 'If you do not...' (Complex) transforms into an imperative + 'or / otherwise' in a Compound sentence.",
      "নিয়ম: 'If you do not...' যুক্ত শর্তসাপেক্ষ Complex বাক্যকে Compound করতে 'or / otherwise' সংযোজক ব্যবহার করা হয়।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Interchange Parts of Speech (Use the Noun form of 'succeed'): 'He succeeded in his attempt.'",
      "'succeed'-এর বিশেষ্য (Noun) রূপ ব্যবহার করে বাক্যটি পুনরায় লিখুন: 'He succeeded in his attempt.'",
      [
        "He was successful in his attempt.",
        "He achieved success in his attempt.",
        "He successfully made his attempt.",
        "His attempt was succeeding.",
      ],
      "B",
      "Rule: 'Success' is the Noun form, 'Successful' is the Adjective form, and 'Successfully' is the Adverb form of the verb 'Succeed'.",
      "নিয়ম: 'Succeed' (ক্রিয়া)-এর Noun রূপ হলো 'Success' (বিশেষ্য), আর 'Successful' হলো Adjective।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Change into Indirect Speech: The teacher said, 'The earth moves round the sun.'",
      "Indirect Speech-এ পরিবর্তন করুন: The teacher said, 'The earth moves round the sun.'",
      [
        "The teacher said that the earth moved round the sun.",
        "The teacher said that the earth moves round the sun.",
        "The teacher told that the earth is moving round the sun.",
        "The teacher asked if the earth moves round the sun.",
      ],
      "B",
      "Rule: When the reported speech states a universal truth or scientific fact, the present tense inside the clause remains unchanged even if the reporting verb is in the past tense.",
      "নিয়ম: উদ্ধৃত অংশটি চিরন্তন সত্য (Universal Truth) হলে রিপোর্টিং ভার্বটি অতীত কালে থাকলেও ভেতরের ক্রিয়ার কাল (Tense) পরিবর্তিত হয় না।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Change into Indirect Speech: He said to me, 'Are you going to Kolkata today?'",
      "Indirect Speech-এ পরিবর্তন করুন: He said to me, 'Are you going to Kolkata today?'",
      [
        "He asked me if I was going to Kolkata that day.",
        "He told me that I was going to Kolkata today.",
        "He asked me whether was I going to Kolkata that day.",
        "He asked me if you were going to Kolkata that day.",
      ],
      "A",
      "Rule: Yes/No questions use 'if/whether', change into statement word order (I was), and 'today' shifts to 'that day'.",
      "নিয়ম: Yes/No প্রশ্নের ক্ষেত্রে 'asked + if/whether' বসে, প্রশ্নবোধক পদক্রম বিবৃতিমূলক হয় এবং 'today' পরিবর্তিত হয়ে 'that day' হয়।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Replace 'Hardly' with 'No sooner': 'Hardly had we reached the station when the train left.'",
      "'Hardly'-এর পরিবর্তে 'No sooner' ব্যবহার করুন: 'Hardly had we reached the station when the train left.'",
      [
        "No sooner had we reached the station when the train left.",
        "No sooner had we reached the station than the train left.",
        "No sooner did we reached the station than the train left.",
        "No sooner we had reached the station than the train left.",
      ],
      "B",
      "Rule: 'Hardly/Scarcely ... when' converts to 'No sooner had + subject + V3 ... than' (or 'No sooner did + subject + V1 ... than').",
      "নিয়ম: 'Hardly ... when'-এর বদলে 'No sooner had ... than' ব্যবহৃত হয় ('No sooner'-এর পর কখনোই 'when' বা 'then' বসে না, সর্বদা 'than' বসে)।",
      "easy",
      "WBPSC High-Yield Trap",
    ],
    [
      "Transform into an Affirmative sentence without changing meaning: 'None but the brave deserves the fair.'",
      "অর্থ না বদলে Affirmative করুন: 'None but the brave deserves the fair.'",
      [
        "Only the brave deserves the fair.",
        "Everyone brave deserves the fair.",
        "No brave person deserves the fair.",
        "The brave do not deserve the fair.",
      ],
      "A",
      "Rule: 'None but' (for persons) in a negative sentence transforms into 'Only' in an affirmative sentence.",
      "নিয়ম: ব্যক্তি বোঝাতে Negative বাক্যে 'None but' থাকলে Affirmative করার সময় তার পরিবর্তে 'Only' বসে।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Transform into a Complex sentence: 'Buy two shirts and get one free.'",
      "Complex বাক্যে রূপান্তর করুন: 'Buy two shirts and get one free.'",
      [
        "If you buy two shirts, you will get one free.",
        "Buying two shirts, you get one free.",
        "You must buy two shirts to get one free.",
        "Buy two shirts for getting one free.",
      ],
      "A",
      "Rule: An imperative + 'and' expressing a condition in a Compound sentence transforms into an 'If-clause' in a Complex sentence.",
      "নিয়ম: শর্ত বোঝাতে 'Imperative + and' যুক্ত Compound বাক্যকে Complex করতে 'If you...' খণ্ডবাক্য ব্যবহৃত হয়।",
      "easy",
      "WBCS Prelims English PYQ",
    ],
    [
      "Change the Voice: 'One should keep one's promises.'",
      "Voice Change করুন: 'One should keep one's promises.'",
      [
        "One's promises should be kept by one.",
        "Promises should be kept.",
        "Promises must be kept by someone.",
        "Let promises be kept.",
      ],
      "B",
      "Rule: Indefinite pronouns like 'one / one's' are omitted in the passive voice: 'Promises should be kept.'",
      "নিয়ম: কর্তা হিসেবে অনির্দিষ্ট সর্বনাম 'One / one's' থাকলে Passive করার সময় 'by one' উহ্য থাকে: 'Promises should be kept.'",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Change the Voice: 'I know him.'",
      "Voice Change করুন: 'I know him.'",
      [
        "He is known by me.",
        "He is known to me.",
        "He was known to me.",
        "He is being known to me.",
      ],
      "B",
      "Rule: The verb 'know' (like 'marry' or 'oblige') takes the preposition 'to' instead of 'by' in the passive voice.",
      "নিয়ম: 'Know' ক্রিয়ার Passive করার সময় 'by'-এর পরিবর্তে সর্বদা 'to' বসে ('known to me')।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Transform into a Simple sentence: 'It is certain that he will come.'",
      "Simple বাক্যে রূপান্তর করুন: 'It is certain that he will come.'",
      [
        "He will come and it is certain.",
        "Certainly he will come.",
        "He may certainly come.",
        "Because of certainty, he will come.",
      ],
      "B",
      "Rule: The principal clause 'It is certain' + noun clause 'that he will come' is condensed into a single clause using the adverb 'Certainly' (or 'His coming is certain').",
      "নিয়ম: 'It is certain that...' খণ্ডবাক্যটিকে ক্রিয়াবিশেষণ 'Certainly' ব্যবহার করে একটিমাত্র সমাপিকা ক্রিয়ার Simple বাক্যে রূপান্তরিত করা হয়।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
    [
      "Transform into an Exclamatory sentence: 'I wish I had the wings of a dove.'",
      "Exclamatory বাক্যে রূপান্তর করুন: 'I wish I had the wings of a dove.'",
      [
        "Had I the wings of a dove!",
        "What wings of a dove I had!",
        "How wings of a dove I have!",
        "Alas, I have no wings of a dove!",
      ],
      "A",
      "Rule: 'I wish I had...' transforms into 'Had I...!' or 'If only I had...!' or 'O that I had...!' in an exclamatory sentence.",
      "নিয়ম: 'I wish I had...' যুক্ত বাক্যকে Exclamatory করতে 'Had I...!' বা 'If only I had...!' ব্যবহার করা হয়।",
      "moderate",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Combine into a single Simple sentence using an Infinitive: 'He has three sons. He has to educate them.'",
      "Infinitive ব্যবহার করে একটি Simple বাক্যে যুক্ত করুন: 'He has three sons. He has to educate them.'",
      [
        "He has three sons who must be educated.",
        "He has three sons to educate.",
        "He has three sons and he must educate them.",
        "Educating three sons is his duty.",
      ],
      "B",
      "Rule: 'to educate' acts as a qualifying infinitive phrase modifying 'three sons', forming a concise Simple sentence.",
      "নিয়ম: 'to educate' ইনফিনিটিভটি 'three sons'-এর উদ্দেশ্য প্রকাশ করে একটি সরল বাক্য (Simple Sentence) গঠন করে।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Combine into a Simple sentence using a Nominative Absolute: 'The sun rose. The fog dispersed.'",
      "Nominative Absolute ব্যবহার করে Simple বাক্যে যুক্ত করুন: 'The sun rose. The fog dispersed.'",
      [
        "When the sun rose, the fog dispersed.",
        "The sun having risen, the fog dispersed.",
        "The sun rose and the fog dispersed.",
        "As the sun rose, the fog dispersed.",
      ],
      "B",
      "Rule: When two actions have different subjects ('the sun' and 'the fog') in a cause-effect sequence, 'Subject + having + V3' (Nominative Absolute) creates a Simple sentence.",
      "নিয়ম: দুটি বাক্যের কর্তা ভিন্ন হলে ('The sun' ও 'The fog') প্রথম কর্তার পর 'having + V3' (Nominative Absolute) বসিয়ে Simple বাক্য করা হয়।",
      "hard",
      "WBCS Prelims English PYQ",
    ],
    [
      "Transform into a Negative sentence without changing the meaning: 'Man is mortal.'",
      "অর্থ পরিবর্তন না করে Negative বাক্যে রূপান্তর করুন: 'Man is mortal.'",
      [
        "Man is not mortal.",
        "Man is not immortal.",
        "No man is mortal.",
        "Immortal is man.",
      ],
      "B",
      "Rule: Using 'not + antonym (immortal)' preserves the original affirmative meaning ('mortal') while making the structure negative.",
      "নিয়ম: মূল শব্দের বিপরীত শব্দের ('immortal') আগে 'not' বসিয়ে অর্থ অপরিবর্তিত রেখে Negative বাক্য গঠন করা হয়।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Change to Superlative Degree: 'Very few cities in India are as large as Kolkata.'",
      "Superlative Degree-তে রূপান্তর করুন: 'Very few cities in India are as large as Kolkata.'",
      [
        "Kolkata is the largest city in India.",
        "Kolkata is one of the largest cities in India.",
        "Kolkata is larger than most other cities in India.",
        "No other city in India is as large as Kolkata.",
      ],
      "B",
      "Rule: Positive 'Very few ... as ... as' always corresponds to Superlative 'one of the + superlative + plural noun'.",
      "নিয়ম: Positive Degree-তে 'Very few' থাকলে Superlative করার সময় সর্বদা 'one of the + superlative + বহুবচন বিশেষ্য' বসে।",
      "easy",
      "WBPSC Clerkship English PYQ",
    ],
    [
      "Identify the sentence type: 'Walk fast lest you should miss the bus.'",
      "বাক্যটির ধরন (Sentence Type) চিহ্নিত করুন: 'Walk fast lest you should miss the bus.'",
      [
        "Simple Sentence",
        "Complex Sentence",
        "Compound Sentence",
        "Optative Sentence",
      ],
      "B",
      "Rule: 'lest ... should' introduces a subordinate adverbial clause of negative purpose, making the sentence Complex.",
      "নিয়ম: 'lest ... should' একটি অপ্রধান উদ্দেশ্যমূলক খণ্ডবাক্য (Subordinate Clause) তৈরি করে, তাই এটি একটি Complex Sentence।",
      "moderate",
      "WBCS Prelims English PYQ",
    ],
  ];

  return raw.map(([stemEn, stemBn, optsEn, correctOption, expEn, expBn, difficulty, examTag]) => ({
    stem: { en: stemEn, bn: stemBn },
    options: {
      A: { en: optsEn[0], bn: optsEn[0] },
      B: { en: optsEn[1], bn: optsEn[1] },
      C: { en: optsEn[2], bn: optsEn[2] },
      D: { en: optsEn[3], bn: optsEn[3] },
    },
    correctOption,
    explanation: { en: expEn, bn: expBn },
    difficulty,
    examTag,
  }));
}

async function seedDefaultRevisionTopics(): Promise<void> {
  // 1. Seed Topic 1: Viceroys of India (1858–1947)
  const viceroyVisuals: RevisionVisualCard[] = [
    {
      id: "viceroy-canning",
      titleEn: "Lord Canning (1856–1862)",
      titleBn: "লর্ড ক্যানিং (১৮৫৬–১৮৬২)",
      subtitleEn: "First Viceroy of India & Crown Transition",
      subtitleBn: "ভারতের প্রথম ভাইসরয় ও মহারাণীর শাসন প্রবর্তন",
      badgeText: "1858 Act · First Viceroy",
      keyFactsEn: [
        "Last Governor-General under East India Company & 1st Viceroy under British Crown",
        "Queen Victoria's Proclamation read at Allahabad Durbar (1 Nov 1858)",
        "Withdrew Doctrine of Lapse; passed Indian Councils Act 1861 (Portfolio System) & IPC 1860",
      ],
      keyFactsBn: [
        "কোম্পানির শেষ গভর্নর-জেনারেল এবং ব্রিটিশ রাজশক্তির অধীনে ভারতের প্রথম ভাইসরয়",
        "১ নভেম্বর ১৮৫৮ এলাহাবাদ দরবারে মহারাণী ভিক্টোরিয়ার ঘোষণাপত্র পাঠ",
        "স্বত্ববিলোপ নীতি প্রত্যাহার; ইন্ডিয়ান পেনাল কোড (১৮৬০) ও পোর্টফোলিও ব্যবস্থা (১৮৬১) প্রবর্তন",
      ],
      svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220" class="w-full h-full">
        <defs>
          <linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1e1b4b"/>
          </linearGradient>
        </defs>
        <rect width="400" height="220" rx="16" fill="url(#bg1)"/>
        <circle cx="85" cy="110" r="54" fill="#312e81" stroke="#fbbf24" stroke-width="2.5"/>
        <!-- Stylised Crown & Portrait Medallion -->
        <path d="M60 82 L72 64 L85 78 L98 64 L110 82 Z" fill="#fbbf24"/>
        <circle cx="85" cy="105" r="16" fill="#fde68a"/>
        <path d="M58 145 Q85 122 112 145" fill="#fbbf24"/>
        <text x="85" y="182" text-anchor="middle" fill="#fde68a" font-size="11" font-family="monospace" font-weight="bold">1856 – 1862</text>
        <text x="160" y="52" fill="#fbbf24" font-size="13" font-weight="bold" font-family="sans-serif">CROWN RULE BEGINS (1858)</text>
        <rect x="160" y="64" width="215" height="36" rx="8" fill="#1e293b" stroke="#475569"/>
        <text x="172" y="86" fill="#f8fafc" font-size="11" font-family="sans-serif">• Govt of India Act 1858 (1st Viceroy)</text>
        <rect x="160" y="108" width="215" height="36" rx="8" fill="#1e293b" stroke="#475569"/>
        <text x="172" y="130" fill="#f8fafc" font-size="11" font-family="sans-serif">• Indian Councils Act &amp; High Courts 1861</text>
        <rect x="160" y="152" width="215" height="36" rx="8" fill="#1e293b" stroke="#475569"/>
        <text x="172" y="174" fill="#34d399" font-size="11" font-family="sans-serif">• Indigo Revolt (1859) &amp; Universities 1857</text>
      </svg>`,
    },
    {
      id: "viceroy-ripon-vs-lytton",
      titleEn: "Lord Lytton (1876–80) vs Lord Ripon (1880–84)",
      titleBn: "লর্ড লিটন (১৮৭৬–৮০) বনাম লর্ড রিপন (১৮৮০–৮৪)",
      subtitleEn: "Most Asked Contrast Pair in WBPSC Exams",
      subtitleBn: "ডব্লিউবিপিএসসি পরীক্ষায় সর্বাধিক আগত তুলনামূলক চার্ট",
      badgeText: "High-Yield Contrast",
      keyFactsEn: [
        "Lytton: Enacted Vernacular Press Act & Arms Act (1878), lowered ICS age from 21 to 19",
        "Ripon: Repealed Vernacular Press Act (1882), Father of Local Self-Govt (1882), 1st Factory Act (1881)",
        "Ripon: First synchronous Census (1881), Hunter Commission (1882), Ilbert Bill controversy (1883)",
      ],
      keyFactsBn: [
        "লর্ড লিটন: ভার্নাকুলার প্রেস অ্যাক্ট ও অস্ত্র আইন (১৮৭৮), আইসিএস পরীক্ষার বয়স ২১ থেকে কমিয়ে ১৯ বছর",
        "লর্ড রিপন: ভার্নাকুলার প্রেস অ্যাক্ট রদ (১৮৮২), স্থানীয় স্বায়ত্তশাসনের জনক (১৮৮২), প্রথম ফ্যাক্টরি আইন (১৮৮১)",
        "লর্ড রিপন: প্রথম নিয়মিত জনগণনা (১৮৮১), হান্টার কমিশন (১৮৮২) ও ইলবার্ট বিল বিতর্ক (১৮৮৩)",
      ],
      svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220" class="w-full h-full">
        <rect width="400" height="220" rx="16" fill="#0f172a"/>
        <rect x="14" y="16" width="178" height="188" rx="12" fill="#450a0a" stroke="#f43f5e" stroke-width="1.5"/>
        <text x="103" y="42" text-anchor="middle" fill="#fda4af" font-size="13" font-weight="bold">LORD LYTTON (1876–80)</text>
        <text x="103" y="60" text-anchor="middle" fill="#fb7185" font-size="10">Repressive / Forward Policy</text>
        <text x="26" y="88" fill="#ffe4e6" font-size="10.5">• Vernacular Press Act 1878</text>
        <text x="26" y="112" fill="#ffe4e6" font-size="10.5">• Indian Arms Act 1878</text>
        <text x="26" y="136" fill="#ffe4e6" font-size="10.5">• ICS Max Age 21 → 19 yrs</text>
        <text x="26" y="160" fill="#ffe4e6" font-size="10.5">• 2nd Anglo-Afghan War</text>
        <text x="26" y="184" fill="#ffe4e6" font-size="10.5">• Delhi Durbar 1877 (Famine)</text>

        <rect x="208" y="16" width="178" height="188" rx="12" fill="#064e3b" stroke="#10b981" stroke-width="1.5"/>
        <text x="297" y="42" text-anchor="middle" fill="#6ee7b7" font-size="13" font-weight="bold">LORD RIPON (1880–84)</text>
        <text x="297" y="60" text-anchor="middle" fill="#34d399" font-size="10">Liberal / Local Self-Govt</text>
        <text x="220" y="88" fill="#d1fae5" font-size="10.5">• Repealed Press Act 1882</text>
        <text x="220" y="112" fill="#d1fae5" font-size="10.5">• 1st Factory Act 1881</text>
        <text x="220" y="136" fill="#d1fae5" font-size="10.5">• Local Self-Govt 1882</text>
        <text x="220" y="160" fill="#d1fae5" font-size="10.5">• Hunter Commission 1882</text>
        <text x="220" y="184" fill="#d1fae5" font-size="10.5">• Ilbert Bill Controversy 1883</text>
      </svg>`,
    },
    {
      id: "viceroy-curzon-mountbatten",
      titleEn: "Lord Curzon (1899–1905) to Mountbatten (1947)",
      titleBn: "লর্ড কার্জন (১৮৯৯–১৯০৫) থেকে মাউন্টব্যাটেন (১৯৪৭)",
      subtitleEn: "Partition of Bengal, Dyarchy & Transfer of Power",
      subtitleBn: "বঙ্গভঙ্গ, দ্বৈত শাসন ও ক্ষমতা হস্তান্তর কালরেখা",
      badgeText: "1905 – 1947 Timeline",
      keyFactsEn: [
        "Curzon (1899–1905): Partition of Bengal (16 Oct 1905), Universities Act & Ancient Monuments Act (1904)",
        "Hardinge II (1911): Annulled Partition of Bengal & shifted capital from Calcutta to Delhi",
        "Linlithgow (1936–43): Longest serving; August Offer (1940), Cripps Mission & Quit India (1942)",
      ],
      keyFactsBn: [
        "লর্ড কার্জন (১৮৯৯–১৯০৫): বঙ্গভঙ্গ (১৬ অক্টোবর ১৯০৫), বিশ্ববিদ্যালয় আইন ও প্রাচীন সৌধ আইন (১৯০৪)",
        "দ্বিতীয় হার্ডিঞ্জ (১৯১১): বঙ্গভঙ্গ রদ এবং কলকাতা থেকে দিল্লিতে রাজধানী স্থানান্তর",
        "লর্ড লিনলিথগো (১৯৩৬–৪৩): দীর্ঘতম মেয়াদের ভাইসরয়; আগস্ট প্রস্তাব (১৯৪০) ও ভারত ছাড়ো আন্দোলন (১৯৪২)",
      ],
      svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220" class="w-full h-full">
        <rect width="400" height="220" rx="16" fill="#0f172a"/>
        <line x1="30" y1="110" x2="370" y2="110" stroke="#38bdf8" stroke-width="3"/>
        <circle cx="55" cy="110" r="10" fill="#f59e0b"/>
        <text x="55" y="88" text-anchor="middle" fill="#fcd34d" font-size="11" font-weight="bold">1905</text>
        <text x="55" y="136" text-anchor="middle" fill="#e2e8f0" font-size="10">Curzon</text>
        <text x="55" y="150" text-anchor="middle" fill="#94a3b8" font-size="9">Bengal Partition</text>

        <circle cx="135" cy="110" r="10" fill="#38bdf8"/>
        <text x="135" y="88" text-anchor="middle" fill="#7dd3fc" font-size="11" font-weight="bold">1911</text>
        <text x="135" y="136" text-anchor="middle" fill="#e2e8f0" font-size="10">Hardinge II</text>
        <text x="135" y="150" text-anchor="middle" fill="#94a3b8" font-size="9">Capital → Delhi</text>

        <circle cx="215" cy="110" r="10" fill="#a855f7"/>
        <text x="215" y="88" text-anchor="middle" fill="#d8b4fe" font-size="11" font-weight="bold">1919</text>
        <text x="215" y="136" text-anchor="middle" fill="#e2e8f0" font-size="10">Chelmsford</text>
        <text x="215" y="150" text-anchor="middle" fill="#94a3b8" font-size="9">Rowlatt / Dyarchy</text>

        <circle cx="295" cy="110" r="10" fill="#ec4899"/>
        <text x="295" y="88" text-anchor="middle" fill="#f9a8d4" font-size="11" font-weight="bold">1942</text>
        <text x="295" y="136" text-anchor="middle" fill="#e2e8f0" font-size="10">Linlithgow</text>
        <text x="295" y="150" text-anchor="middle" fill="#94a3b8" font-size="9">Quit India</text>

        <circle cx="360" cy="110" r="10" fill="#10b981"/>
        <text x="360" y="88" text-anchor="middle" fill="#6ee7b7" font-size="11" font-weight="bold">1947</text>
        <text x="360" y="136" text-anchor="middle" fill="#e2e8f0" font-size="10">Mountbatten</text>
        <text x="360" y="150" text-anchor="middle" fill="#94a3b8" font-size="9">Independence</text>
      </svg>`,
    },
  ];

  const viceroyMarkdownEn = `### 1. High-Yield Chronological Master Table (Only Exam-Asked Points)

| Viceroy & Tenure | Landmark Acts, Commissions & Events Asked in WBPSC |
| :--- | :--- |
| **Lord Canning (1856–1862)** | • **First Viceroy of India** (Govt of India Act 1858)<br>• Withdrew **Doctrine of Lapse**<br>• **Indian Penal Code (1860)**, **Indian Councils Act (1861)** (Portfolio System), **Indian High Courts Act (1861)**<br>• **Indigo Revolt (1859–60)** & White Mutiny by European troops |
| **Lord John Lawrence (1864–1869)** | • Policy of **'Masterly Inactivity'** towards Afghanistan<br>• Bhutan War (1865); opened telegraphic communication with Europe |
| **Lord Mayo (1869–1872)** | • **First Census of India (1872 — non-synchronous)**<br>• Founded **Mayo College** (Ajmer) & Statistical Survey of India<br>• **Only Viceroy assassinated in office** (by Sher Ali Afridi at Port Blair, 1872) |
| **Lord Lytton (1876–1880)** | • **Royal Titles Act (1876)** & First Delhi Durbar (1877 — Queen Victoria as *Kaiser-i-Hind*)<br>• **Vernacular Press Act (1878)** & **Arms Act (1878)**<br>• Reduced maximum age for **ICS exam from 21 to 19 years** |
| **Lord Ripon (1880–1884)** | • **Repealed Vernacular Press Act (1882)**<br>• **First Factory Act (1881)** & **First synchronous decennial Census (1881)**<br>• **Father of Local Self-Government (1882 Resolution)**<br>• **Hunter Commission** on Education (1882) & **Ilbert Bill Controversy (1883)** |
| **Lord Dufferin (1884–1888)** | • **Foundation of Indian National Congress (28 Dec 1885)** by A.O. Hume<br>• Called Congress a **'microscopic minority'**<br>• Third Anglo-Burmese War (1885 — annexation of Upper Burma) |
| **Lord Lansdowne (1888–1894)** | • **Second Factory Act (1891)** & **Indian Councils Act (1892)**<br>• **Durand Commission (1893)** demarcated boundary between British India & Afghanistan |
| **Lord Curzon (1899–1905)** | • **Partition of Bengal (16 October 1905)**<br>• **Raleigh Commission (1902)** $\\rightarrow$ **Indian Universities Act (1904)**<br>• **Ancient Monuments Preservation Act (1904)** & **Fraser Police Commission (1902)** |
| **Lord Minto II (1905–1910)** | • **Swadeshi Movement (1905)**, **Muslim League founded at Dacca (1906)**, **Surat Split (1907)**<br>• **Morley-Minto Reforms (1909)** — Separate Electorates for Muslims |
| **Lord Hardinge II (1910–1916)** | • **Delhi Durbar (1911)**: Annulment of Partition of Bengal & **Capital shifted from Calcutta to Delhi**<br>• Bomb thrown at him in Chandni Chowk (1912 — Rashbehari Bose); Gandhi returned from South Africa (1915) |
| **Lord Chelmsford (1916–1921)** | • **Lucknow Pact (1916)** & Home Rule Leagues<br>• **Montagu's August Declaration (1917)** & **Govt of India Act 1919 (Dyarchy in Provinces)**<br>• **Rowlatt Act (1919)**, **Jallianwala Bagh Massacre (13 April 1919)** & Non-Cooperation Movement |
| **Lord Reading (1921–1926)** | • **Only Jewish Viceroy**; **Chauri Chaura incident (Feb 1922)**<br>• Formation of **Swaraj Party (1923)** & **Kakori Train Robbery (1925)** |
| **Lord Irwin (1926–1931)** | • **Simon Commission arrival (1928)**, Nehru Report (1928)<br>• **Deepavali Declaration (31 Oct 1929)** on Dominion Status<br>• **Lahore Congress (Purna Swaraj, 1929)**, **Dandi March (1930)**, **1st Round Table Conference**, **Gandhi-Irwin Pact (5 March 1931)** |
| **Lord Willingdon (1931–1936)** | • **2nd & 3rd Round Table Conferences**<br>• **Communal Award (1932)** by Ramsay MacDonald & **Poona Pact (Sept 1932)**<br>• **Government of India Act 1935** passed |
| **Lord Linlithgow (1936–1943)** | • **Longest-serving Viceroy of India**<br>• **August Offer (1940)**, Individual Satyagraha (1940)<br>• **Cripps Mission (March 1942)** & **Quit India Movement (8 August 1942)** |
| **Lord Wavell (1943–1947)** | • **C.R. Formula (1944)**, **Wavell Plan & Simla Conference (June 1945)**<br>• **INA Trials (1945)**, **RIN Mutiny (Feb 1946)** & **Cabinet Mission (1946)** |
| **Lord Mountbatten (1947)** | • **Last British Viceroy** & **First Governor-General of Independent India**<br>• **June 3 Plan (Mountbatten Plan)**, Radcliffe Commission & Indian Independence Act 1947 |`;

  const viceroyMarkdownBn = `### ১. ভাইসরয়দের সম্পূর্ণ পরীক্ষামুখী সারণি (শুধুমাত্র পরীক্ষায় আসা তথ্য)

| ভাইসরয় ও সময়কাল | ডব্লিউবিপিএসসি (WBPSC) পরীক্ষায় বারবার আসা আইন, কমিশন ও ঘটনা |
| :--- | :--- |
| **লর্ড ক্যানিং (১৮৫৬–১৮৬২)** | • **ভারতের প্রথম ভাইসরয়** (১৮৫৮ সালের ভারত শাসন আইন)<br>• **স্বত্ববিলোপ নীতি** প্রত্যাহার<br>• **ভারতীয় দণ্ডবিধি (IPC ১৮৬০)**, **পোর্টফোলিও ব্যবস্থা (১৮৬১)** এবং **হাইকোর্ট আইন (১৮৬১)**<br>• **নীল বিদ্রোহ (১৮৫৯–৬০)** |
| **লর্ড জন লরেন্স (১৮৬৪–১৮৬৯)** | • আফগানিস্তানের প্রতি **'নৈপুণ্যপূর্ণ নিষ্ক্রিয়তা' (Masterly Inactivity)** নীতি<br>• ভুটান যুদ্ধ (১৮৬৫) এবং ইউরোপের সাথে টেলিগ্রাফ যোগাযোগ চালু |
| **লর্ড মেয়ো (১৮৬৯–১৮৭২)** | • **ভারতের প্রথম জনগণনা (১৮৭২ — অসমলয়)**<br>• আজমিরে মেয়ো কলেজ ও ভারতের পরিসংখ্যান সমীক্ষা প্রতিষ্ঠা<br>• **কর্মরত অবস্থায় নিহত একমাত্র ভাইসরয়** (১৮৭২ সালে পোর্ট ব্লেয়ারে শের আলী আফ্রিদির হাতে) |
| **লর্ড লিটন (১৮৭৬–১৮৮০)** | • **ভার্নাকুলার প্রেস অ্যাক্ট (১৮৭৮)** ও **অস্ত্র আইন (১৮৭৮)**<br>• আইসিএস (ICS) পরীক্ষার সর্বোচ্চ বয়স **২১ থেকে কমিয়ে ১৯ বছর** করা হয় |
| **লর্ড রিপন (১৮৮০–১৮৮৪)** | • **ভার্নাকুলার প্রেস অ্যাক্ট রদ (১৮৮২)**<br>• **প্রথম ফ্যাক্টরি আইন (১৮৮১)** ও **প্রথম নিয়মিত দশবার্ষিকী জনগণনা (১৮৮১)**<br>• **ভারতে স্থানীয় স্বায়ত্তশাসনের জনক (১৮৮২)**, **হান্টার কমিশন (১৮৮২)** ও **ইলবার্ট বিল বিতর্ক (১৮৮৩)** |
| **লর্ড ডাফরিন (১৮৮৪–১৮৮৮)** | • **ভারতীয় জাতীয় কংগ্রেস প্রতিষ্ঠা (২৮ ডিসেম্বর ১৮৮৫)**<br>• কংগ্রেসকে **'আণুবীক্ষণিক সংখ্যালঘু' (Microscopic Minority)** বলে ব্যঙ্গ |
| **লর্ড কার্জন (১৮৯৯–১৯০৫)** | • **বঙ্গভঙ্গ (১৬ অক্টোবর ১৯০৫)**<br>• **র‍্যালে কমিশন (১৯০২)** ও **ভারতীয় বিশ্ববিদ্যালয় আইন (১৯০৪)**<br>• **প্রাচীন সৌধ সংরক্ষণ আইন (১৯০৪)** ও ফ্রেজার পুলিশ কমিশন |
| **দ্বিতীয় লর্ড মিন্টো (১৯০৫–১৯১০)** | • **স্বদেশী আন্দোলন (১৯০৫)**, **ঢাকায় মুসলিম লীগ প্রতিষ্ঠা (১৯০৬)**, **সুরাট বিচ্ছেদ (১৯০৭)**<br>• **মর্লে-মিন্টো সংস্কার (১৯০৯)** — মুসলিমদের জন্য পৃথক নির্বাচকমণ্ডলী |
| **দ্বিতীয় লর্ড হার্ডিঞ্জ (১৯১০–১৯১৬)** | • **দিল্লি দরবার (১৯১১)**: বঙ্গভঙ্গ রদ এবং **কলকাতা থেকে দিল্লিতে রাজধানী স্থানান্তর** |
| **লর্ড চেমসফোর্ড (১৯১৬–১৯২১)** | • **মন্টেগু-চেমসফোর্ড সংস্কার (১৯১৯ — প্রদেশে দ্বৈত শাসন)**<br>• **রাওলাট আইন (১৯১৯)**, **জালিয়ানওয়ালাবাগ হত্যাকাণ্ড (১৩ এপ্রিল ১৯১৯)** ও অসহযোগ আন্দোলন |
| **লর্ড রিডিং (১৯২১–১৯২৬)** | • **চৌরি চৌরা ঘটনা (ফেব্রুয়ারি ১৯২২)**, **স্বরাজ্য দল গঠন (১৯২৩)** ও **কাকোরি ট্রেন ডাকাতি (১৯২৫)** |
| **লর্ড আরউইন (১৯২৬–১৯৩১)** | • **সাইমন কমিশনের আগমন (১৯২৮)**, **দীপাবলি ঘোষণা (১৯২৯)**, **ডান্ডি অভিযান (১৯৩০)** ও **গান্ধী-আরউইন চুক্তি (৫ মার্চ ১৯৩১)** |
| **লর্ড উইলিংডন (১৯৩১–১৯৩৬)** | • **দ্বিতীয় ও তৃতীয় গোলটেবিল বৈঠক**, **সাম্প্রদায়িক বাঁটোয়ারা ও পুনা চুক্তি (১৯৩২)**, **১৯৩৫ সালের ভারত শাসন আইন** |
| **লর্ড লিনলিথগো (১৯৩৬–১৯৪৩)** | • **ভারতের দীর্ঘতম মেয়াদের ভাইসরয়**<br>• **আগস্ট প্রস্তাব (১৯৪০)**, **ক্রিপস মিশন (১৯৪২)** ও **ভারত ছাড়ো আন্দোলন (১৯৪২)** |
| **লর্ড ওয়াভেল (১৯৪৩–১৯৪৭)** | • **সিমলা সম্মেলন ও ওয়াভেল পরিকল্পনা (১৯৪৫)**, **নৌ-বিদ্রোহ (১৯৪৬)** ও **ক্যাবিনেট মিশন (১৯৪৬)** |
| **লর্ড মাউন্টব্যাটেন (১৯৪৭)** | • **ব্রিটিশ ভারতের শেষ ভাইসরয়** এবং **স্বাধীন ভারতের প্রথম গভর্নর-জেনারেল**<br>• **৩ জুনের মাউন্টব্যাটেন পরিকল্পনা** ও ১৯৪৭ সালের ভারতের স্বাধীনতা আইন |`;

  const [viceroyTopic] = await queryClient<{ id: string }[]>`
    INSERT INTO revision_topics (
      exam_slug, subject_en, subject_bn, topic_slug, title_en, title_bn,
      summary_en, summary_bn, content_markdown_en, content_markdown_bn,
      exam_traps_en, exam_traps_bn, visuals_json
    ) VALUES (
      'wbcs-prelims',
      'History of India & National Movement',
      'ভারতের ইতিহাস ও জাতীয় আন্দোলন',
      'viceroys-of-india-1858-1947',
      'Viceroys of India (1858–1947) — Acts, Commissions & Chronology',
      'ভারতের ভাইসরয়গণ (১৮৫৮–১৯৪৭) — আইন, কমিশন ও কালানুক্রমিক সারণি',
      'High-yield quick revision of all 20 Viceroys from Lord Canning to Lord Mountbatten with visual comparison cards and 30 PYQ-grade MCQs.',
      'লর্ড ক্যানিং থেকে লর্ড মাউন্টব্যাটেন পর্যন্ত সকল ভাইসরয়ের গুরুত্বপূর্ণ আইন, কমিশন ও ৩০টি বাছাই করা MCQ প্র্যাকটিস সেট।',
      ${viceroyMarkdownEn},
      ${viceroyMarkdownBn},
      ${JSON.stringify([
        "First Census (1872) = Lord Mayo (non-synchronous), whereas First Regular Decennial Census (1881) = Lord Ripon.",
        "Delhi Durbar 1877 = Lord Lytton; Delhi Durbar 1903 = Lord Curzon; Delhi Durbar 1911 (Capital shift) = Lord Hardinge II.",
        "Congress attended ONLY the Second Round Table Conference (1931) after the Gandhi-Irwin Pact.",
      ])}::jsonb,
      ${JSON.stringify([
        "প্রথম জনগণনা (১৮৭২) = লর্ড মেয়ো, কিন্তু প্রথম নিয়মিত দশবার্ষিকী জনগণনা (১৮৮১) = লর্ড রিপন।",
        "১৮৭৭ দিল্লি দরবার = লর্ড লিটন; ১৯০৩ দিল্লি দরবার = লর্ড কার্জন; ১৯১১ দিল্লি দরবার (রাজধানী স্থানান্তর) = দ্বিতীয় লর্ড হার্ডিঞ্জ।",
        "গান্ধী-আরউইন চুক্তির পর কংগ্রেস শুধুমাত্র দ্বিতীয় গোলটেবিল বৈঠকে (১৯৩১) অংশগ্রহণ করেছিল।",
      ])}::jsonb,
      ${JSON.stringify(viceroyVisuals)}::jsonb
    )
    RETURNING id
  `;

  if (viceroyTopic) {
    const [setRow] = await queryClient<{ id: string }[]>`
      INSERT INTO revision_topic_question_sets (
        topic_id, set_number, set_label, generated_by_name, generated_by_role, question_count
      ) VALUES (
        ${viceroyTopic.id}, 0, 'Official Admin Set #1 (30 High-Yield Questions)', 'WBPSC Admin', 'admin', 30
      )
      RETURNING id
    `;
    const qs = buildViceroyQuestions();
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      await queryClient`
        INSERT INTO revision_topic_questions (
          set_id, topic_id, position, stem, options, correct_option, explanation, difficulty, exam_tag
        ) VALUES (
          ${setRow.id},
          ${viceroyTopic.id},
          ${i + 1},
          ${JSON.stringify(q.stem)}::jsonb,
          ${JSON.stringify(q.options)}::jsonb,
          ${q.correctOption},
          ${JSON.stringify(q.explanation)}::jsonb,
          ${q.difficulty},
          ${q.examTag}
        )
      `;
    }
  }

  // 2. Seed Topic 2: General English — Sentence Transformations
  const engVisuals: RevisionVisualCard[] = [
    {
      id: "eng-simple-complex-compound",
      titleEn: "Simple ↔ Complex ↔ Compound Conversion Matrix",
      titleBn: "Simple ↔ Complex ↔ Compound রূপান্তর সূত্র",
      subtitleEn: "Golden Conjunction & Phrase Mapping Chart",
      subtitleBn: "সংযোজক ও বাক্যাংশ পরিবর্তনের এক-নজরে তালিকা",
      badgeText: "Core Grammar Matrix",
      keyFactsEn: [
        "Too + adj + to + V1 (Simple)  ⟷  So + adj + that + Sub + cannot/could not + V1 (Complex)",
        "In spite of / Despite + Noun/V-ing (Simple)  ⟷  Although / Though (Complex)  ⟷  But / Yet (Compound)",
        "Without + V-ing (Simple)  ⟷  Unless / If ... not (Complex)  ⟷  Imperative + or (Compound)",
      ],
      keyFactsBn: [
        "Too ... to (Simple)  ⟷  So ... that + Sub + cannot/could not (Complex)  ⟷  Very ... and so (Compound)",
        "In spite of / Despite (Simple)  ⟷  Although / Though (Complex)  ⟷  But / Yet (Compound)",
        "Without + V-ing (Simple)  ⟷  Unless / If ... not (Complex)  ⟷  Or / Otherwise (Compound)",
      ],
      svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220" class="w-full h-full">
        <rect width="400" height="220" rx="16" fill="#0f172a"/>
        <text x="200" y="34" text-anchor="middle" fill="#38bdf8" font-size="13" font-weight="bold">SENTENCE TRANSFORMATION TRIANGLE</text>
        <rect x="20" y="54" width="110" height="142" rx="10" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
        <text x="75" y="76" text-anchor="middle" fill="#7dd3fc" font-size="12" font-weight="bold">SIMPLE</text>
        <text x="30" y="102" fill="#e2e8f0" font-size="10">• too ... to</text>
        <text x="30" y="124" fill="#e2e8f0" font-size="10">• In spite of + V-ing</text>
        <text x="30" y="146" fill="#e2e8f0" font-size="10">• On + V-ing</text>
        <text x="30" y="168" fill="#e2e8f0" font-size="10">• Without + V-ing</text>

        <rect x="145" y="54" width="110" height="142" rx="10" fill="#1e293b" stroke="#fbbf24" stroke-width="1.5"/>
        <text x="200" y="76" text-anchor="middle" fill="#fde68a" font-size="12" font-weight="bold">COMPLEX</text>
        <text x="155" y="102" fill="#e2e8f0" font-size="10">• so ... that</text>
        <text x="155" y="124" fill="#e2e8f0" font-size="10">• Though / Although</text>
        <text x="155" y="146" fill="#e2e8f0" font-size="10">• When / As soon as</text>
        <text x="155" y="168" fill="#e2e8f0" font-size="10">• Unless / If ... not</text>

        <rect x="270" y="54" width="110" height="142" rx="10" fill="#1e293b" stroke="#34d399" stroke-width="1.5"/>
        <text x="325" y="76" text-anchor="middle" fill="#6ee7b7" font-size="12" font-weight="bold">COMPOUND</text>
        <text x="280" y="102" fill="#e2e8f0" font-size="10">• very ... and so</text>
        <text x="280" y="124" fill="#e2e8f0" font-size="10">• ... but / yet ...</text>
        <text x="280" y="146" fill="#e2e8f0" font-size="10">• ... and at once ...</text>
        <text x="280" y="168" fill="#e2e8f0" font-size="10">• ... or / otherwise ...</text>
      </svg>`,
    },
    {
      id: "eng-degree-no-sooner",
      titleEn: "Degree of Comparison & 'No Sooner' Inversion Rules",
      titleBn: "Degree পরিবর্তন ও 'No Sooner' ইনভার্সন নিয়ম",
      subtitleEn: "Zero-Error Formula for Clerkship & WBCS Prelims",
      subtitleBn: "ক্লার্কশিপ ও ডব্লিউবিসিএস প্রিলিমসের নির্ভুল সূত্র",
      badgeText: "Inversion & Degree",
      keyFactsEn: [
        "As soon as + S + V2  ⟶  No sooner had + S + V3 ... than (NEVER 'when' or 'then')",
        "Hardly / Scarcely had + S + V3 ... when / before (NEVER 'than')",
        "The + Superlative  ⟷  Comparative + than any other  ⟷  No other ... as + Positive + as",
      ],
      keyFactsBn: [
        "No sooner had + S + V3 ... than (কখনোই 'when' বা 'then' বসবে না)",
        "Hardly / Scarcely had + S + V3 ... when / before (কখনোই 'than' বসবে না)",
        "One of the + Superlative  ⟷  than most other (Comp.)  ⟷  Very few ... as ... as (Pos.)",
      ],
      svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220" class="w-full h-full">
        <rect width="400" height="220" rx="16" fill="#0f172a"/>
        <rect x="20" y="20" width="360" height="82" rx="10" fill="#31102f" stroke="#ec4899" stroke-width="1.5"/>
        <text x="34" y="44" fill="#f9a8d4" font-size="12" font-weight="bold">TRAP #1: CORRELATIVE INVERSION PAIRS</text>
        <text x="34" y="66" fill="#f8fafc" font-size="11" font-family="monospace">✓ No sooner had + Sub + V3 ... THAN</text>
        <text x="34" y="86" fill="#f8fafc" font-size="11" font-family="monospace">✓ Hardly / Scarcely had + Sub + V3 ... WHEN</text>

        <rect x="20" y="116" width="360" height="84" rx="10" fill="#0c2e27" stroke="#10b981" stroke-width="1.5"/>
        <text x="34" y="140" fill="#6ee7b7" font-size="12" font-weight="bold">TRAP #2: PASSIVE PREPOSITION EXCEPTIONS</text>
        <text x="34" y="162" fill="#f8fafc" font-size="11">• Known TO me  • Surprised AT  • Satisfied WITH</text>
        <text x="34" y="182" fill="#f8fafc" font-size="11">• Contained IN  • Annoyed WITH (person) / AT (thing)</text>
      </svg>`,
    },
  ];

  const engMarkdownEn = `### 1. Simple, Complex & Compound Transformation Rules (Exam Blueprint)

| Meaning / Function | Simple Sentence (1 Finite Verb) | Complex Sentence (Subordinate Clause) | Compound Sentence (Coordinate Clause) |
| :--- | :--- | :--- | :--- |
| **Negative Result** | **too** + adj + **to** + V1<br>*He is too weak to walk.* | **so** + adj + **that** + S + **cannot/could not**<br>*He is so weak that he cannot walk.* | **very** + adj + **and so**<br>*He is very weak and so he cannot walk.* |
| **Concession / Contrast** | **In spite of / Despite** + Possessive + Noun/Gerund<br>*In spite of his poverty, he is honest.* | **Although / Though** + S + V<br>*Although he is poor, he is honest.* | **but / yet / still**<br>*He is poor, yet he is honest.* |
| **Time / Immediate Sequence** | **On + V-ing** / Present Participle<br>*Seeing the police, the thief fled.* | **When / As soon as** + S + V<br>*As soon as he saw the police, the thief fled.* | **and / and at once**<br>*The thief saw the police and fled.* |
| **Negative Condition** | **Without + V-ing**<br>*Without working hard, you will fail.* | **Unless** + S + V / **If ... not**<br>*Unless you work hard, you will fail.* | **Imperative + or / otherwise**<br>*Work hard, or you will fail.* |
| **Cause / Reason** | **Because of / Owing to / Being**<br>*Being ill, he could not attend.* | **As / Since / Because** + S + V<br>*As he was ill, he could not attend.* | **and therefore / so**<br>*He was ill, and so he could not attend.* |

---

### 2. Affirmative $\\leftrightarrow$ Negative without Changing Meaning
* **Only (Person)** $\\longrightarrow$ **None but** (*Only the brave deserves the fair* $\\rightarrow$ *None but the brave deserves the fair.*)
* **Only (Thing)** $\\longrightarrow$ **Nothing but** (*He has only a few books* $\\rightarrow$ *He has nothing but a few books.*)
* **Only (Number/Age)** $\\longrightarrow$ **Not more than / Not less than** (*He is only ten* $\\rightarrow$ *He is not more than ten.*)
* **Every + Noun** $\\longrightarrow$ **There is no + Noun + but + Verb** (*Every mother loves her child* $\\rightarrow$ *There is no mother but loves her child.*)
* **As soon as** $\\longrightarrow$ **No sooner had + Subject + $V_3$ ... than**

---

### 3. Degree of Comparison Conversion Table

| Type | Superlative | Comparative | Positive |
| :--- | :--- | :--- | :--- |
| **Type A (Absolute Best)** | **the + Superlative**<br>*Iron is the most useful metal.* | **Comparative + than any other + Singular**<br>*Iron is more useful than any other metal.* | **No other + Singular + is as ... as**<br>*No other metal is as useful as iron.* |
| **Type B (One of the Best)** | **one of the + Superlative + Plural**<br>*Kolkata is one of the largest cities.* | **Comparative + than most other + Plural**<br>*Kolkata is larger than most other cities.* | **Very few + Plural + are as ... as**<br>*Very few cities are as large as Kolkata.* |`;

  const engMarkdownBn = `### ১. Simple, Complex ও Compound বাক্য রূপান্তরের মূল সূত্রাবলি

| অর্থের ধরন | Simple Sentence (সরল বাক্য) | Complex Sentence (জটিল বাক্য) | Compound Sentence (যৌগিক বাক্য) |
| :--- | :--- | :--- | :--- |
| **নেতিবাচক ফলাফল** | **too** + adj + **to** + V1<br>*He is too weak to walk.* | **so** + adj + **that** + S + **cannot/could not**<br>*He is so weak that he cannot walk.* | **very** + adj + **and so**<br>*He is very weak and so he cannot walk.* |
| **বৈপরীত্য (Contrast)** | **In spite of / Despite** + Noun/V-ing<br>*In spite of his poverty, he is honest.* | **Although / Though** + S + V<br>*Although he is poor, he is honest.* | **but / yet**<br>*He is poor, yet he is honest.* |
| **শর্ত (Condition)** | **Without + V-ing**<br>*Without working hard, you will fail.* | **Unless** / **If ... not**<br>*Unless you work hard, you will fail.* | **Imperative + or / otherwise**<br>*Work hard, or you will fail.* |

---

### ২. অর্থ পরিবর্তন না করে Affirmative $\\leftrightarrow$ Negative করার নিয়ম
* **Only (ব্যক্তি)** $\\longrightarrow$ **None but** (*Only the brave deserves the fair* $\\rightarrow$ *None but the brave deserves the fair.*)
* **Only (বস্তু)** $\\longrightarrow$ **Nothing but**
* **Only (সংখ্যা বা বয়স)** $\\longrightarrow$ **Not more than / Not less than**
* **Every + Noun** $\\longrightarrow$ **There is no + Noun + but + Verb**
* **As soon as** $\\longrightarrow$ **No sooner had + কর্তা + $V_3$ ... than** (মনে রাখবেন: *No sooner*-এর সাথে সর্বদা **than** বসে, আর *Hardly/Scarcely*-র সাথে **when** বসে)।`;

  const [engTopic] = await queryClient<{ id: string }[]>`
    INSERT INTO revision_topics (
      exam_slug, subject_en, subject_bn, topic_slug, title_en, title_bn,
      summary_en, summary_bn, content_markdown_en, content_markdown_bn,
      exam_traps_en, exam_traps_bn, visuals_json
    ) VALUES (
      'wbpsc-clerkship',
      'General English',
      'জেনারেল ইংলিশ',
      'sentence-transformations-grammar',
      'Sentence Transformations — Simple/Complex/Compound, Voice & Degree',
      'বাক্য রূপান্তর (Sentence Transformation) — Simple/Complex/Compound, Voice ও Degree',
      'Complete exam-oriented cheat sheet for WBPSC Clerkship & WBCS Prelims English grammar transformations with visual rule diagrams and 30 PYQ MCQs.',
      'ডব্লিউবিপিএসসি ক্লার্কশিপ এবং ডব্লিউবিসিএস প্রিলিমস ইংরেজি গ্রামারের বাক্য রূপান্তর, ভয়েস ও ডিগ্রি পরিবর্তনের শর্ট নোটস এবং ৩০টি প্র্যাকটিস প্রশ্ন।',
      ${engMarkdownEn},
      ${engMarkdownBn},
      ${JSON.stringify([
        "Never pair 'No sooner' with 'when' or 'then' — always use 'than' (No sooner had ... than).",
        "In Passive Voice, 'know', 'marry', and 'oblige' take 'to' (known to me), NOT 'by'.",
        "'One of the + superlative' always takes a PLURAL noun and maps to 'Very few' in Positive degree.",
      ])}::jsonb,
      ${JSON.stringify([
        "'No sooner'-এর পর সর্বদা 'than' বসে ('when' বা 'then' বসে না)।",
        "Passive Voice-এ 'know' ক্রিয়ার পর 'by' না বসে সর্বদা 'to' বসে ('known to me')।",
        "'One of the + superlative'-এর পর সর্বদা বহুবচন বিশেষ্য বসে এবং Positive Degree-তে 'Very few' হয়।",
      ])}::jsonb,
      ${JSON.stringify(engVisuals)}::jsonb
    )
    RETURNING id
  `;

  if (engTopic) {
    const [setRow] = await queryClient<{ id: string }[]>`
      INSERT INTO revision_topic_question_sets (
        topic_id, set_number, set_label, generated_by_name, generated_by_role, question_count
      ) VALUES (
        ${engTopic.id}, 0, 'Official Admin Set #1 (30 High-Yield Questions)', 'WBPSC Admin', 'admin', 30
      )
      RETURNING id
    `;
    const qs = buildSentenceTransformationQuestions();
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      await queryClient`
        INSERT INTO revision_topic_questions (
          set_id, topic_id, position, stem, options, correct_option, explanation, difficulty, exam_tag
        ) VALUES (
          ${setRow.id},
          ${engTopic.id},
          ${i + 1},
          ${JSON.stringify(q.stem)}::jsonb,
          ${JSON.stringify(q.options)}::jsonb,
          ${q.correctOption},
          ${JSON.stringify(q.explanation)}::jsonb,
          ${q.difficulty},
          ${q.examTag}
        )
      `;
    }
  }
}

// ============================================================================
// 2. AI Generation Helpers for Exam-Oriented Topic Notes & 30-MCQ Sets
// ============================================================================

async function generateTopicNoteAndQuestionsWithAi(params: {
  examSlug: string;
  subjectEn: string;
  topicTitleEn: string;
  customFocus?: string;
}): Promise<{
  subjectBn: string;
  titleBn: string;
  summaryEn: string;
  summaryBn: string;
  contentMarkdownEn: string;
  contentMarkdownBn: string;
  examTrapsEn: string[];
  examTrapsBn: string[];
  visuals: RevisionVisualCard[];
}> {
  const ai = getGenAIClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Create a high-yield, exam-oriented Quick Revision Note for West Bengal Public Service Commission (WBPSC Clerkship, WBCS Prelims, Food SI, Miscellaneous) aspirants:
Exam: ${params.examSlug}
Subject: ${params.subjectEn}
Topic: ${params.topicTitleEn}
${params.customFocus ? `Admin Focus Instructions: ${params.customFocus}` : ""}

Requirements:
1. Include ONLY the high-yield facts, dates, articles, rules, comparison tables, and one-liners that are directly asked in WBPSC exams.
2. Provide complete English ("contentMarkdownEn") and formal Bengali ("contentMarkdownBn" বাংলা) Markdown notes with comparison tables and bullet points.
3. Provide 3 specific WBPSC exam trap alerts in English ("examTrapsEn") and Bengali ("examTrapsBn").
4. Generate 2 visual infographic cards ("visualCards") summarizing the central idea, portrait/emblem/diagram, or rule matrix of the topic, including a clean self-contained dark-themed SVG illustration ("svgMarkup" with viewBox="0 0 400 220" using slate-900 background #0f172a and vibrant amber/sky/emerald text and shapes).`,
    config: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          subjectBn: { type: Type.STRING },
          titleBn: { type: Type.STRING },
          summaryEn: { type: Type.STRING },
          summaryBn: { type: Type.STRING },
          contentMarkdownEn: { type: Type.STRING },
          contentMarkdownBn: { type: Type.STRING },
          examTrapsEn: { type: Type.ARRAY, items: { type: Type.STRING } },
          examTrapsBn: { type: Type.ARRAY, items: { type: Type.STRING } },
          visualCards: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                titleEn: { type: Type.STRING },
                titleBn: { type: Type.STRING },
                subtitleEn: { type: Type.STRING },
                subtitleBn: { type: Type.STRING },
                badgeText: { type: Type.STRING },
                keyFactsEn: { type: Type.ARRAY, items: { type: Type.STRING } },
                keyFactsBn: { type: Type.ARRAY, items: { type: Type.STRING } },
                svgMarkup: { type: Type.STRING },
              },
              required: [
                "titleEn",
                "titleBn",
                "subtitleEn",
                "subtitleBn",
                "badgeText",
                "keyFactsEn",
                "keyFactsBn",
                "svgMarkup",
              ],
            },
          },
        },
        required: [
          "subjectBn",
          "titleBn",
          "summaryEn",
          "summaryBn",
          "contentMarkdownEn",
          "contentMarkdownBn",
          "examTrapsEn",
          "examTrapsBn",
          "visualCards",
        ],
      },
    },
  });

  const parsed = JSON.parse(response.text || "{}") as {
    subjectBn?: string;
    titleBn?: string;
    summaryEn?: string;
    summaryBn?: string;
    contentMarkdownEn?: string;
    contentMarkdownBn?: string;
    examTrapsEn?: string[];
    examTrapsBn?: string[];
    visualCards?: Array<Omit<RevisionVisualCard, "id">>;
  };

  const visuals: RevisionVisualCard[] = (parsed.visualCards || []).map((vc, i) => ({
    id: `visual-${Date.now()}-${i + 1}`,
    ...vc,
  }));

  return {
    subjectBn: parsed.subjectBn || params.subjectEn,
    titleBn: parsed.titleBn || params.topicTitleEn,
    summaryEn: parsed.summaryEn || `High-yield exam-oriented revision notes on ${params.topicTitleEn}.`,
    summaryBn: parsed.summaryBn || `${params.topicTitleEn} বিষয়ের পরীক্ষামুখী সংক্ষিপ্ত নোটস।`,
    contentMarkdownEn: parsed.contentMarkdownEn || `# ${params.topicTitleEn}`,
    contentMarkdownBn: parsed.contentMarkdownBn || `# ${params.topicTitleEn}`,
    examTrapsEn: parsed.examTrapsEn || [],
    examTrapsBn: parsed.examTrapsBn || [],
    visuals,
  };
}

async function generate30TopicQuestionsWithAi(params: {
  examSlug: string;
  subjectEn: string;
  topicTitleEn: string;
  avoidStems: string[];
}): Promise<
  Array<{
    stem: BilingualText;
    options: Record<OptionKey, BilingualText>;
    correctOption: OptionKey;
    explanation: BilingualText;
    difficulty: "easy" | "moderate" | "hard";
    examTag: string;
  }>
> {
  const ai = getGenAIClient();
  const collected: Array<{
    stem: BilingualText;
    options: Record<OptionKey, BilingualText>;
    correctOption: OptionKey;
    explanation: BilingualText;
    difficulty: "easy" | "moderate" | "hard";
    examTag: string;
  }> = [];
  const avoid = [...params.avoidStems];

  // Generate in two fast batches of 15 to guarantee 30 complete bilingual questions without hitting token limits
  for (let batchIdx = 0; batchIdx < 2; batchIdx++) {
    const needed = 30 - collected.length;
    if (needed <= 0) break;
    const count = Math.min(15, needed);

    const avoidBlock =
      avoid.length > 0
        ? `\nStrictly DO NOT repeat or paraphrase any of these existing question stems:\n${avoid
            .slice(-60)
            .map((s) => `- ${s}`)
            .join("\n")}`
        : "";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate ${count} high-yield, exam-focused Multiple-Choice Questions (MCQs) exclusively on the topic "${params.topicTitleEn}" (Subject: ${params.subjectEn}, Exam: ${params.examSlug}).
Requirements:
1. Only ask questions that are directly relevant to WBPSC Clerkship, WBCS Prelims, Food SI, and Miscellaneous exams.
2. Provide BOTH English ("en") and Bengali ("bn" বাংলা) for the stem, all 4 options (A, B, C, D), and a concise 1–2 sentence explanation.
3. For General English grammar topics (such as Sentence Transformations, Voice, Narration, Prepositions), keep the tested English sentences in English and provide a clear bilingual explanation of the grammar rule.${avoidBlock}`,
      config: {
        temperature: 0.45,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  stem: BILINGUAL_SCHEMA,
                  options: {
                    type: Type.OBJECT,
                    properties: {
                      A: BILINGUAL_SCHEMA,
                      B: BILINGUAL_SCHEMA,
                      C: BILINGUAL_SCHEMA,
                      D: BILINGUAL_SCHEMA,
                    },
                    required: ["A", "B", "C", "D"],
                  },
                  correctOption: { type: Type.STRING, enum: ["A", "B", "C", "D"] },
                  explanation: BILINGUAL_SCHEMA,
                  difficulty: { type: Type.STRING, enum: ["easy", "moderate", "hard"] },
                  examTag: { type: Type.STRING },
                },
                required: ["stem", "options", "correctOption", "explanation", "difficulty", "examTag"],
              },
            },
          },
          required: ["questions"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}") as {
      questions?: Array<{
        stem: BilingualText;
        options: Record<OptionKey, BilingualText>;
        correctOption: OptionKey;
        explanation: BilingualText;
        difficulty: "easy" | "moderate" | "hard";
        examTag: string;
      }>;
    };

    for (const q of parsed.questions || []) {
      if (!q.stem?.en?.trim()) continue;
      collected.push(q);
      avoid.push(q.stem.en.trim());
      if (collected.length >= 30) break;
    }
  }

  return collected;
}

// ============================================================================
// 3. Fastify Routes for Exam-Oriented Notes & Topic Practice Tests
// ============================================================================

const CreateTopicSchema = z.object({
  examSlug: z.string().min(2).max(80).default("wbcs-prelims"),
  subjectEn: z.string().min(2).max(160),
  topicTitleEn: z.string().min(2).max(240),
  customFocus: z.string().max(1000).optional(),
  customImageUrl: z.string().max(2_000_000).optional(),
});

const SubmitTopicTestSchema = z.object({
  setId: z.string().uuid(),
  answers: z.record(z.string(), z.enum(["A", "B", "C", "D"])),
  timeSpentSeconds: z.number().int().min(0).max(36000).default(0),
});

export const revisionNotesRoutes: FastifyPluginAsync = async (fastify) => {
  await ensureRevisionNotesSchema();

  /**
   * GET /revision-notes
   * Lists all published Exam-Oriented Quick Revision Topics.
   * Shows how many question sets exist and how many custom 30-MCQ sets the current user has generated (out of 2 max).
   */
  fastify.get("/", { preHandler: [requireUser] }, async (request) => {
    const user = (await loadSessionUser(request))!;
    const isAdmin = user.role === "admin";
    const isPremium = isAdmin || user.subscriptionTier !== "free";

    const rows = await queryClient<
      Array<{
        id: string;
        exam_slug: string;
        subject_en: string;
        subject_bn: string;
        topic_slug: string;
        title_en: string;
        title_bn: string;
        summary_en: string;
        summary_bn: string;
        visuals_json: RevisionVisualCard[];
        created_at: string;
        total_sets: string;
        total_questions: string;
        user_generated_sets: string;
        total_attempts: string;
      }>
    >`
      SELECT
        t.id,
        t.exam_slug,
        t.subject_en,
        t.subject_bn,
        t.topic_slug,
        t.title_en,
        t.title_bn,
        t.summary_en,
        t.summary_bn,
        t.visuals_json,
        t.created_at,
        (SELECT COUNT(*)::text FROM revision_topic_question_sets s WHERE s.topic_id = t.id) AS total_sets,
        (SELECT COUNT(*)::text FROM revision_topic_questions q WHERE q.topic_id = t.id) AS total_questions,
        (
          SELECT COUNT(*)::text
          FROM revision_topic_question_sets s
          WHERE s.topic_id = t.id
            AND s.generated_by_user_id = ${user.id}
            AND s.generated_by_role = 'aspirant'
        ) AS user_generated_sets,
        (
          SELECT COUNT(*)::text
          FROM revision_topic_attempts a
          WHERE a.topic_id = t.id
            AND (${isAdmin} OR a.user_id = ${user.id})
        ) AS total_attempts
      FROM revision_topics t
      WHERE t.is_published = TRUE
      ORDER BY t.created_at DESC
    `;

    return {
      isPremium,
      maxAspirantGenerationsPerTopic: 2,
      topics: rows.map((r) => {
        const usedGen = Number(r.user_generated_sets || 0);
        return {
          id: r.id,
          examSlug: r.exam_slug,
          subjectEn: r.subject_en,
          subjectBn: r.subject_bn,
          topicSlug: r.topic_slug,
          titleEn: r.title_en,
          titleBn: r.title_bn,
          summaryEn: r.summary_en,
          summaryBn: r.summary_bn,
          visualCount: Array.isArray(r.visuals_json) ? r.visuals_json.length : 0,
          previewVisual: Array.isArray(r.visuals_json) && r.visuals_json.length > 0 ? r.visuals_json[0] : null,
          totalSets: Number(r.total_sets || 1),
          totalQuestions: Number(r.total_questions || 30),
          userGeneratedSetsCount: usedGen,
          remainingGenerations: Math.max(0, 2 - usedGen),
          totalAttempts: Number(r.total_attempts || 0),
          createdAt: r.created_at,
        };
      }),
    };
  });

  /**
   * GET /revision-notes/:id
   * Returns full Exam-Oriented Quick Revision Note, Visuals, Question Sets, and Attempts.
   * Gatekept to Premium Aspirants & Admins.
   * - Premium Aspirant sees: Official Admin Question Set(s) + their own generated sets + their own attempts.
   * - Admin sees: Official Admin Question Set(s) + ALL Aspirant-generated sets across all users + ALL student attempts.
   */
  fastify.get("/:id", { preHandler: [requireUser] }, async (request, reply) => {
    const user = (await loadSessionUser(request))!;
    const isAdmin = user.role === "admin";
    const isPremium = isAdmin || user.subscriptionTier !== "free";

    if (!isPremium) {
      return reply.status(403).send({
        error:
          "Exam-Oriented Quick Revision Notes & 30-MCQ Topic Practice Tests are an exclusive Premium Aspirant feature. Please upgrade your subscription plan to unlock.",
      });
    }

    const { id } = request.params as { id: string };
    const topics = await queryClient<
      Array<{
        id: string;
        exam_slug: string;
        subject_en: string;
        subject_bn: string;
        topic_slug: string;
        title_en: string;
        title_bn: string;
        summary_en: string;
        summary_bn: string;
        content_markdown_en: string;
        content_markdown_bn: string;
        exam_traps_en: string[];
        exam_traps_bn: string[];
        visuals_json: RevisionVisualCard[];
        created_at: string;
      }>
    >`
      SELECT *
      FROM revision_topics
      WHERE id = ${id}
      LIMIT 1
    `;

    const topic = topics[0];
    if (!topic) {
      return reply.status(404).send({ error: "Revision topic not found." });
    }

    const sets = await queryClient<
      Array<{
        id: string;
        topic_id: string;
        set_number: number;
        set_label: string;
        generated_by_user_id: string | null;
        generated_by_name: string;
        generated_by_role: string;
        question_count: number;
        created_at: string;
      }>
    >`
      SELECT *
      FROM revision_topic_question_sets
      WHERE topic_id = ${id}
        AND (
          ${isAdmin}
          OR generated_by_role = 'admin'
          OR generated_by_user_id = ${user.id}
        )
      ORDER BY set_number ASC, created_at ASC
    `;

    const setIds = sets.map((s) => s.id);
    const questionsRows =
      setIds.length > 0
        ? await queryClient<
            Array<{
              id: string;
              set_id: string;
              position: number;
              stem: BilingualText;
              options: Record<OptionKey, BilingualText>;
              correct_option: OptionKey;
              explanation: BilingualText;
              difficulty: string;
              exam_tag: string;
            }>
          >`
            SELECT id, set_id, position, stem, options, correct_option, explanation, difficulty, exam_tag
            FROM revision_topic_questions
            WHERE topic_id = ${id}
            ORDER BY position ASC
          `
        : [];

    const attemptsRows = await queryClient<
      Array<{
        id: string;
        set_id: string;
        user_id: string;
        user_name: string;
        total_questions: number;
        attempted_count: number;
        correct_count: number;
        incorrect_count: number;
        net_score: string;
        max_score: string;
        accuracy_percentage: string;
        time_spent_seconds: number;
        created_at: string;
      }>
    >`
      SELECT
        id, set_id, user_id, user_name, total_questions, attempted_count,
        correct_count, incorrect_count, net_score, max_score, accuracy_percentage,
        time_spent_seconds, created_at
      FROM revision_topic_attempts
      WHERE topic_id = ${id}
        AND (${isAdmin} OR user_id = ${user.id})
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const userGeneratedCount = sets.filter(
      (s) => s.generated_by_user_id === user.id && s.generated_by_role === "aspirant"
    ).length;

    return {
      topic: {
        id: topic.id,
        examSlug: topic.exam_slug,
        subjectEn: topic.subject_en,
        subjectBn: topic.subject_bn,
        topicSlug: topic.topic_slug,
        titleEn: topic.title_en,
        titleBn: topic.title_bn,
        summaryEn: topic.summary_en,
        summaryBn: topic.summary_bn,
        contentMarkdownEn: topic.content_markdown_en,
        contentMarkdownBn: topic.content_markdown_bn,
        examTrapsEn: topic.exam_traps_en || [],
        examTrapsBn: topic.exam_traps_bn || [],
        visuals: topic.visuals_json || [],
        createdAt: topic.created_at,
      },
      userGeneratedSetsCount: userGeneratedCount,
      remainingGenerations: Math.max(0, 2 - userGeneratedCount),
      questionSets: sets.map((s) => ({
        id: s.id,
        setNumber: s.set_number,
        setLabel: s.set_label,
        generatedByUserId: s.generated_by_user_id,
        generatedByName: s.generated_by_name,
        generatedByRole: s.generated_by_role,
        questionCount: s.question_count,
        createdAt: s.created_at,
        questions: questionsRows
          .filter((q) => q.set_id === s.id)
          .map((q) => ({
            id: q.id,
            position: q.position,
            stem: q.stem,
            options: q.options,
            // Admin always sees correctOption & explanation; Aspirants also receive them for instant topic practice review
            correctOption: q.correct_option,
            explanation: q.explanation,
            difficulty: q.difficulty,
            examTag: q.exam_tag,
          })),
      })),
      attempts: attemptsRows.map((a) => ({
        id: a.id,
        setId: a.set_id,
        userId: a.user_id,
        userName: a.user_name,
        totalQuestions: a.total_questions,
        attemptedCount: a.attempted_count,
        correctCount: a.correct_count,
        incorrectCount: a.incorrect_count,
        netScore: Number(a.net_score),
        maxScore: Number(a.max_score),
        accuracyPercentage: Number(a.accuracy_percentage),
        timeSpentSeconds: a.time_spent_seconds,
        createdAt: a.created_at,
      })),
    };
  });

  /**
   * POST /revision-notes (Admin Only)
   * Generates a brand-new Exam-Oriented Quick Revision Note + SVG/Image Visuals + 30 Initial MCQs.
   */
  fastify.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = (await loadSessionUser(request))!;
    const parsed = CreateTopicSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid topic payload",
        details: parsed.error.flatten(),
      });
    }

    const { examSlug, subjectEn, topicTitleEn, customFocus, customImageUrl } = parsed.data;
    const topicSlug =
      topicTitleEn
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 120) +
      "-" +
      Date.now().toString(36);

    const [noteData, initialQuestions] = await Promise.all([
      generateTopicNoteAndQuestionsWithAi({
        examSlug,
        subjectEn,
        topicTitleEn,
        customFocus,
      }),
      generate30TopicQuestionsWithAi({
        examSlug,
        subjectEn,
        topicTitleEn,
        avoidStems: [],
      }),
    ]);

    if (customImageUrl && noteData.visuals.length > 0) {
      noteData.visuals[0].imageUrl = customImageUrl;
    } else if (customImageUrl) {
      noteData.visuals.unshift({
        id: `custom-img-${Date.now()}`,
        titleEn: topicTitleEn,
        titleBn: noteData.titleBn,
        subtitleEn: subjectEn,
        subtitleBn: noteData.subjectBn,
        badgeText: "Topic Visual",
        keyFactsEn: [],
        keyFactsBn: [],
        svgMarkup: "",
        imageUrl: customImageUrl,
      });
    }

    const [createdTopic] = await queryClient<{ id: string }[]>`
      INSERT INTO revision_topics (
        exam_slug, subject_en, subject_bn, topic_slug, title_en, title_bn,
        summary_en, summary_bn, content_markdown_en, content_markdown_bn,
        exam_traps_en, exam_traps_bn, visuals_json, created_by
      ) VALUES (
        ${examSlug},
        ${subjectEn},
        ${noteData.subjectBn},
        ${topicSlug},
        ${topicTitleEn},
        ${noteData.titleBn},
        ${noteData.summaryEn},
        ${noteData.summaryBn},
        ${noteData.contentMarkdownEn},
        ${noteData.contentMarkdownBn},
        ${JSON.stringify(noteData.examTrapsEn)}::jsonb,
        ${JSON.stringify(noteData.examTrapsBn)}::jsonb,
        ${JSON.stringify(noteData.visuals)}::jsonb,
        ${user.id}
      )
      RETURNING id
    `;

    const [setRow] = await queryClient<{ id: string }[]>`
      INSERT INTO revision_topic_question_sets (
        topic_id, set_number, set_label, generated_by_user_id, generated_by_name,
        generated_by_role, question_count
      ) VALUES (
        ${createdTopic.id},
        0,
        'Official Admin Set #1 (30 Questions)',
        ${user.id},
        ${user.fullName || "WBPSC Admin"},
        'admin',
        ${initialQuestions.length}
      )
      RETURNING id
    `;

    for (let i = 0; i < initialQuestions.length; i++) {
      const q = initialQuestions[i];
      await queryClient`
        INSERT INTO revision_topic_questions (
          set_id, topic_id, position, stem, options, correct_option, explanation, difficulty, exam_tag
        ) VALUES (
          ${setRow.id},
          ${createdTopic.id},
          ${i + 1},
          ${JSON.stringify(q.stem)}::jsonb,
          ${JSON.stringify(q.options)}::jsonb,
          ${q.correctOption},
          ${JSON.stringify(q.explanation)}::jsonb,
          ${q.difficulty},
          ${q.examTag || "WBPSC High-Yield"}
        )
      `;
    }

    return reply.status(201).send({
      topicId: createdTopic.id,
      questionCount: initialQuestions.length,
    });
  });

  /**
   * POST /revision-notes/:id/generate-questions
   * Generates a new set of 30 Practice MCQs on this topic.
   * - Premium Aspirants can generate a new set of 30 questions AT MOST 2 TIMES per topic.
   * - All generated sets are saved in PostgreSQL so both the Aspirant and Admin can view & test them!
   */
  fastify.post("/:id/generate-questions", { preHandler: [requireUser] }, async (request, reply) => {
    const user = (await loadSessionUser(request))!;
    const isAdmin = user.role === "admin";
    const isPremium = isAdmin || user.subscriptionTier !== "free";

    if (!isPremium) {
      return reply.status(403).send({
        error: "Premium subscription required to generate new 30-question topic practice sets.",
      });
    }

    const { id } = request.params as { id: string };
    const topics = await queryClient<
      Array<{
        id: string;
        exam_slug: string;
        subject_en: string;
        title_en: string;
      }>
    >`
      SELECT id, exam_slug, subject_en, title_en
      FROM revision_topics
      WHERE id = ${id}
      LIMIT 1
    `;
    const topic = topics[0];
    if (!topic) {
      return reply.status(404).send({ error: "Revision topic not found." });
    }

    // Check how many sets this user has already generated for this topic
    const userSets = await queryClient<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM revision_topic_question_sets
      WHERE topic_id = ${id}
        AND generated_by_user_id = ${user.id}
        AND generated_by_role = 'aspirant'
    `;
    const usedCount = Number(userSets[0]?.cnt ?? 0);

    if (!isAdmin && usedCount >= 2) {
      return reply.status(429).send({
        error:
          "You have already generated the maximum of 2 custom 30-question practice sets for this topic.",
      });
    }

    // Fetch existing stems on this topic to avoid duplicates
    const existingRows = await queryClient<Array<{ stem_en: string }>>`
      SELECT (stem ->> 'en') AS stem_en
      FROM revision_topic_questions
      WHERE topic_id = ${id}
      LIMIT 120
    `;
    const avoidStems = existingRows.map((r) => r.stem_en).filter(Boolean);

    const newQuestions = await generate30TopicQuestionsWithAi({
      examSlug: topic.exam_slug,
      subjectEn: topic.subject_en,
      topicTitleEn: topic.title_en,
      avoidStems,
    });

    if (newQuestions.length === 0) {
      return reply.status(502).send({ error: "AI returned 0 questions. Please try again." });
    }

    const nextSetNumber = usedCount + 1;
    const roleLabel = isAdmin ? "admin" : "aspirant";
    const setLabel = isAdmin
      ? `Admin Additional Set (${newQuestions.length} Questions)`
      : `Aspirant Set #${nextSetNumber}/2 — Generated by ${user.fullName || user.email} (${newQuestions.length} Qs)`;

    const [createdSet] = await queryClient<{ id: string }[]>`
      INSERT INTO revision_topic_question_sets (
        topic_id, set_number, set_label, generated_by_user_id, generated_by_name,
        generated_by_role, question_count
      ) VALUES (
        ${id},
        ${nextSetNumber},
        ${setLabel},
        ${user.id},
        ${user.fullName || user.email},
        ${roleLabel},
        ${newQuestions.length}
      )
      RETURNING id
    `;

    for (let i = 0; i < newQuestions.length; i++) {
      const q = newQuestions[i];
      await queryClient`
        INSERT INTO revision_topic_questions (
          set_id, topic_id, position, stem, options, correct_option, explanation, difficulty, exam_tag
        ) VALUES (
          ${createdSet.id},
          ${id},
          ${i + 1},
          ${JSON.stringify(q.stem)}::jsonb,
          ${JSON.stringify(q.options)}::jsonb,
          ${q.correctOption},
          ${JSON.stringify(q.explanation)}::jsonb,
          ${q.difficulty},
          ${q.examTag || "WBPSC Topic Practice"}
        )
      `;
    }

    return reply.status(201).send({
      setId: createdSet.id,
      questionCount: newQuestions.length,
      remainingGenerations: isAdmin ? 99 : Math.max(0, 2 - nextSetNumber),
    });
  });

  /**
   * POST /revision-notes/:id/submit-test
   * Deterministically evaluates the 30-question topic practice test (+1 correct, -0.25 wrong)
   * and saves the result in `revision_topic_attempts` (visible to both the student and Admin).
   */
  fastify.post("/:id/submit-test", { preHandler: [requireUser] }, async (request, reply) => {
    const user = (await loadSessionUser(request))!;
    const { id } = request.params as { id: string };
    const parsed = SubmitTopicTestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid test submission payload" });
    }

    const { setId, answers, timeSpentSeconds } = parsed.data;
    const questions = await queryClient<
      Array<{
        id: string;
        position: number;
        correct_option: OptionKey;
      }>
    >`
      SELECT id, position, correct_option
      FROM revision_topic_questions
      WHERE topic_id = ${id} AND set_id = ${setId}
      ORDER BY position ASC
    `;

    if (questions.length === 0) {
      return reply.status(404).send({ error: "Question set not found for this topic." });
    }

    let attemptedCount = 0;
    let correctCount = 0;
    let incorrectCount = 0;

    for (const q of questions) {
      const picked = answers[q.id];
      if (!picked) continue;
      attemptedCount++;
      if (picked === q.correct_option) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    }

    const maxScore = questions.length;
    const netScore = Number((correctCount * 1 - incorrectCount * 0.25).toFixed(2));
    const accuracyPercentage =
      attemptedCount > 0 ? Number(((correctCount / attemptedCount) * 100).toFixed(2)) : 0;

    const [attempt] = await queryClient<{ id: string; created_at: string }[]>`
      INSERT INTO revision_topic_attempts (
        topic_id, set_id, user_id, user_name, total_questions,
        attempted_count, correct_count, incorrect_count,
        net_score, max_score, accuracy_percentage, time_spent_seconds, answers_json
      ) VALUES (
        ${id},
        ${setId},
        ${user.id},
        ${user.fullName || user.email},
        ${questions.length},
        ${attemptedCount},
        ${correctCount},
        ${incorrectCount},
        ${netScore},
        ${maxScore},
        ${accuracyPercentage},
        ${timeSpentSeconds},
        ${JSON.stringify(answers)}::jsonb
      )
      RETURNING id, created_at
    `;

    return {
      attemptId: attempt.id,
      totalQuestions: questions.length,
      attemptedCount,
      correctCount,
      incorrectCount,
      netScore,
      maxScore,
      accuracyPercentage,
      timeSpentSeconds,
      createdAt: attempt.created_at,
    };
  });

  /**
   * DELETE /revision-notes/:id (Admin Only)
   */
  fastify.delete("/:id", { preHandler: [requireAdmin] }, async (request) => {
    const { id } = request.params as { id: string };
    await queryClient`DELETE FROM revision_topics WHERE id = ${id}`;
    return { deleted: true };
  });
};
