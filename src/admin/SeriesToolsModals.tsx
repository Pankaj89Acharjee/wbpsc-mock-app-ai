import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  FileUp,
  Printer,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  BULK_IMPORT_CSV_COLUMNS,
  BULK_IMPORT_TEMPLATE_EXAMPLES,
  WBPSC_EXAM_PRESETS,
  toCsv,
  type ExamDto,
  type GenerateFullQuestionSetResult,
  type SeriesDto,
  type SeriesExportDto,
  type SeriesImportSetResult,
  type SyllabusTreeDto,
} from "../../packages/shared-types/src/index";
import { adminApi, downloadCsv } from "./adminApi";
import { btn, inputCls } from "./ui";

// ============================================================================
// 1. SeriesExportModal — Export Test Series Questions in PDF & Excel (.xls/.csv)
// ============================================================================

type PdfLangMode = "bilingual" | "en" | "bn";
type PdfAnswerMode = "end_key" | "inline" | "paper_only";

function escapeXml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Builds a multi-worksheet Excel SpreadsheetML (.xls) file with UTF-8 Bengali support */
function buildExcelWorkbookXml(data: SeriesExportDto): string {
  const headers = [
    "Q.No",
    "Subject (EN)",
    "Subject (BN)",
    "Chapter (EN)",
    "Subtopic (EN)",
    "Question (English)",
    "প্রশ্ন (বাংলা)",
    "Option A (EN)",
    "Option A (BN)",
    "Option B (EN)",
    "Option B (BN)",
    "Option C (EN)",
    "Option C (BN)",
    "Option D (EN)",
    "Option D (BN)",
    "Correct Option",
    "Explanation (English)",
    "ব্যাখ্যা (বাংলা)",
    "Difficulty",
    "Source / PYQ",
  ];

  const questionRowsXml = data.questions
    .map(
      (q) => `<Row>
        <Cell><Data ss:Type="Number">${q.questionNumber}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.subjectName.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.subjectName.bn)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.chapterName.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.subtopicName.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.stem.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.stem.bn)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.A.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.A.bn)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.B.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.B.bn)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.C.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.C.bn)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.D.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.options.D.bn)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.correctOption)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.explanation.en)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.explanation.bn)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.difficulty)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(q.previousYearTag ?? q.source)}</Data></Cell>
      </Row>`
    )
    .join("\n");

  const summaryRowsXml = data.series.subjects
    .map(
      (s) => `<Row>
        <Cell><Data ss:Type="String">${escapeXml(s.label)}</Data></Cell>
        <Cell><Data ss:Type="Number">${s.targetCount}</Data></Cell>
        <Cell><Data ss:Type="Number">${s.selected}</Data></Cell>
      </Row>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E293B" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Questions">
  <Table>
   <Row ss:StyleID="Header">
    ${headers.map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join("")}
   </Row>
   ${questionRowsXml}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Test Summary">
  <Table>
   <Row ss:StyleID="Header">
    <Cell><Data ss:Type="String">Exam</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(data.exam.title.en)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(data.exam.title.bn)}</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Test Series</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(data.series.name.en)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(data.series.name.bn)}</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Duration (Minutes)</Data></Cell>
    <Cell><Data ss:Type="Number">${data.series.durationMinutes}</Data></Cell>
    <Cell><Data ss:Type="String">Marks: +${data.series.marksPerCorrect} / -${data.series.negativeMarksPerWrong}</Data></Cell>
   </Row>
   <Row ss:StyleID="Header">
    <Cell><Data ss:Type="String">Subject</Data></Cell>
    <Cell><Data ss:Type="String">Target Questions</Data></Cell>
    <Cell><Data ss:Type="String">Exported Questions</Data></Cell>
   </Row>
   ${summaryRowsXml}
  </Table>
 </Worksheet>
</Workbook>`;
}

export function SeriesExportModal({
  seriesId,
  seriesName,
  onClose,
}: {
  seriesId: string;
  seriesName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<SeriesExportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [langMode, setLangMode] = useState<PdfLangMode>("bilingual");
  const [answerMode, setAnswerMode] = useState<PdfAnswerMode>("end_key");

  useEffect(() => {
    setLoading(true);
    adminApi<SeriesExportDto>(`/series/${seriesId}/export`)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [seriesId]);

  const safeSlug = useMemo(
    () =>
      (data?.series.slug || seriesName)
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-|-$/g, "") || "test-series",
    [data?.series.slug, seriesName]
  );

  const handleDownloadExcelXls = () => {
    if (!data) return;
    const xml = buildExcelWorkbookXml(data);
    const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeSlug}-questions.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    if (!data) return;
    const rows = data.questions.map((q) => ({
      exam: data.exam.slug,
      subject: q.subjectName.en,
      chapter: q.chapterName.en,
      subtopic: q.subtopicName.en,
      stem_en: q.stem.en,
      stem_bn: q.stem.bn,
      option_a_en: q.options.A.en,
      option_a_bn: q.options.A.bn,
      option_b_en: q.options.B.en,
      option_b_bn: q.options.B.bn,
      option_c_en: q.options.C.en,
      option_c_bn: q.options.C.bn,
      option_d_en: q.options.D.en,
      option_d_bn: q.options.D.bn,
      correct_option: q.correctOption,
      explanation_en: q.explanation.en,
      explanation_bn: q.explanation.bn,
      difficulty: q.difficulty,
      source: q.source,
      pyq_exam: "",
      pyq_year: q.previousYearTag ?? "",
    }));
    downloadCsv(`${safeSlug}-questions.csv`, toCsv(rows, BULK_IMPORT_CSV_COLUMNS));
  };

  const handlePrintPdf = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0">
      {/* Print-only stylesheet so window.print() exports ONLY the clean question paper PDF */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #wbpsc-printable-paper, #wbpsc-printable-paper * {
            visibility: visible !important;
          }
          #wbpsc-printable-paper {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #ffffff !important;
            color: #0f172a !important;
            padding: 16px !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl print:max-w-none print:max-h-none print:border-none print:bg-white">
        {/* Header (Hidden in Print) */}
        <div className="no-print flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 bg-slate-950">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-emerald-400" />
              Export Test Series Questions (PDF &amp; Excel) — {seriesName}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Download the complete question set in Excel (`.xls` or `.csv`) or print/save as a
              formatted bilingual PDF Question Paper &amp; Answer Key.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 cursor-pointer"
            aria-label="Close export modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Loading test series questions for export…
          </div>
        ) : error ? (
          <div className="p-6 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 m-4 rounded-xl">
            {error}
          </div>
        ) : data ? (
          <>
            {/* Export Controls Bar (Hidden in Print) */}
            <div className="no-print p-4 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              {/* Excel Export Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-300 mr-1">Excel Formats:</span>
                <button
                  type="button"
                  onClick={handleDownloadExcelXls}
                  disabled={data.questions.length === 0}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Download Excel Workbook (.xls)
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  disabled={data.questions.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download CSV (UTF-8)
                </button>
              </div>

              {/* PDF Options & Print Button */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-300 mr-1">PDF Options:</span>
                <select
                  aria-label="PDF Language"
                  value={langMode}
                  onChange={(e) => setLangMode(e.target.value as PdfLangMode)}
                  className="px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="bilingual">Bilingual (English + বাংলা)</option>
                  <option value="en">English Only</option>
                  <option value="bn">Bengali Only (বাংলা)</option>
                </select>
                <select
                  aria-label="PDF Answer Key Mode"
                  value={answerMode}
                  onChange={(e) => setAnswerMode(e.target.value as PdfAnswerMode)}
                  className="px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="end_key">Question Paper + Answer Key at End</option>
                  <option value="inline">Inline Answers &amp; Explanations</option>
                  <option value="paper_only">Question Paper Only (Student Copy)</option>
                </select>
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  disabled={data.questions.length === 0}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  Export / Save as PDF
                </button>
              </div>
            </div>

            {/* Printable PDF Preview Area */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-950 print:p-0 print:bg-white">
              {data.questions.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
                  This test series has no selected questions yet. Select or import questions into the
                  series first.
                </div>
              ) : (
                <div
                  id="wbpsc-printable-paper"
                  className="bg-white text-slate-900 rounded-xl p-8 max-w-4xl mx-auto shadow-lg space-y-6"
                >
                  {/* Exam Paper Header */}
                  <div className="border-b-2 border-slate-900 pb-4 text-center space-y-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-600">
                      {data.exam.title.en} {data.exam.title.bn ? `· ${data.exam.title.bn}` : ""}
                    </p>
                    <h1 className="text-xl font-bold text-slate-950">{data.series.name.en}</h1>
                    {data.series.name.bn && data.series.name.bn !== data.series.name.en && (
                      <p className="text-base font-bengali text-slate-800">{data.series.name.bn}</p>
                    )}
                    <div className="flex flex-wrap justify-center gap-6 pt-2 text-xs font-semibold text-slate-700">
                      <span>Total Questions: {data.questions.length}</span>
                      <span>Time Allowed: {data.series.durationMinutes} Minutes</span>
                      <span>
                        Full Marks:{" "}
                        {(data.questions.length * data.series.marksPerCorrect).toFixed(0)} (+
                        {data.series.marksPerCorrect} / −{data.series.negativeMarksPerWrong})
                      </span>
                    </div>
                  </div>

                  {/* Questions List */}
                  <div className="space-y-5">
                    {data.questions.map((q) => (
                      <div
                        key={q.questionId}
                        className="border-b border-slate-200 pb-4 break-inside-avoid space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 text-sm">
                            {(langMode === "bilingual" || langMode === "en") && (
                              <p className="font-semibold text-slate-900">
                                <span className="font-mono mr-1.5">Q{q.questionNumber}.</span>
                                {q.stem.en}
                              </p>
                            )}
                            {(langMode === "bilingual" || langMode === "bn") && q.stem.bn && (
                              <p className="font-bengali text-slate-800">
                                {langMode === "bn" && (
                                  <span className="font-mono font-bold mr-1.5">
                                    প্রশ্ন {q.questionNumber}.
                                  </span>
                                )}
                                {q.stem.bn}
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                            {q.subjectName.en}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-4 text-xs">
                          {(["A", "B", "C", "D"] as const).map((optKey) => {
                            const opt = q.options[optKey];
                            const isCorrect = answerMode === "inline" && q.correctOption === optKey;
                            return (
                              <div
                                key={optKey}
                                className={`p-1.5 rounded ${
                                  isCorrect
                                    ? "bg-emerald-50 border border-emerald-400 font-semibold text-emerald-950"
                                    : "text-slate-800"
                                }`}
                              >
                                <span className="font-mono font-bold mr-1.5">({optKey})</span>
                                {(langMode === "bilingual" || langMode === "en") && (
                                  <span>{opt.en}</span>
                                )}
                                {langMode === "bilingual" && opt.bn && (
                                  <span className="font-bengali text-slate-700"> / {opt.bn}</span>
                                )}
                                {langMode === "bn" && (
                                  <span className="font-bengali">{opt.bn || opt.en}</span>
                                )}
                                {isCorrect && <span className="ml-1.5 text-emerald-700">✓</span>}
                              </div>
                            );
                          })}
                        </div>

                        {answerMode === "inline" && (
                          <div className="pl-4 pt-1 text-xs text-slate-700 bg-slate-50 p-2.5 rounded border border-slate-200 space-y-1">
                            <p className="font-semibold text-emerald-800">
                              Correct Answer: Option ({q.correctOption})
                            </p>
                            {(langMode === "bilingual" || langMode === "en") &&
                              q.explanation.en && <p>{q.explanation.en}</p>}
                            {(langMode === "bilingual" || langMode === "bn") &&
                              q.explanation.bn && (
                                <p className="font-bengali text-slate-700">{q.explanation.bn}</p>
                              )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* End-of-Paper Answer Key & Explanations */}
                  {answerMode === "end_key" && (
                    <div className="pt-6 border-t-2 border-slate-900 space-y-4 break-before-page">
                      <h2 className="text-base font-bold text-slate-950 uppercase tracking-wider">
                        Answer Key &amp; Detailed Solutions ({data.series.name.en})
                      </h2>
                      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 text-xs font-mono">
                        {data.questions.map((q) => (
                          <div
                            key={q.questionId}
                            className="p-1.5 border border-slate-300 rounded text-center bg-slate-50"
                          >
                            <span className="text-slate-500">{q.questionNumber}:</span>{" "}
                            <strong className="text-slate-950">{q.correctOption}</strong>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3 pt-3">
                        {data.questions.map((q) => (
                          <div
                            key={q.questionId}
                            className="text-xs space-y-0.5 border-b border-slate-200 pb-2"
                          >
                            <p className="font-semibold text-slate-900">
                              Q{q.questionNumber}. Correct Option: ({q.correctOption}) —{" "}
                              {q.options[q.correctOption].en}
                            </p>
                            {(langMode === "bilingual" || langMode === "en") &&
                              q.explanation.en && (
                                <p className="text-slate-700">{q.explanation.en}</p>
                              )}
                            {(langMode === "bilingual" || langMode === "bn") &&
                              q.explanation.bn && (
                                <p className="font-bengali text-slate-700">{q.explanation.bn}</p>
                              )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ============================================================================
// 2. SeriesImportSetModal — Import Whole Question Set directly into a Test Series
// ============================================================================

export function SeriesImportSetModal({
  exam,
  series,
  tree,
  onClose,
  onImported,
}: {
  exam: ExamDto;
  series: SeriesDto;
  tree: SyllabusTreeDto | undefined;
  onClose: () => void;
  onImported: (result: SeriesImportSetResult) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"csv" | "media">("csv");
  const [fileName, setFileName] = useState("");
  const [csvOrJsonFormat, setCsvOrJsonFormat] = useState<"csv" | "json">("csv");
  const [textContent, setTextContent] = useState("");
  const [mediaBase64, setMediaBase64] = useState("");
  const [mediaMime, setMediaMime] = useState<
    "application/pdf" | "image/png" | "image/jpeg" | "image/webp"
  >("application/pdf");
  const [autoUpdateBlueprint, setAutoUpdateBlueprint] = useState(series.status !== "published");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SeriesImportSetResult | null>(null);

  const handleCsvOrJsonPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".json")) {
      setError("Please select a .csv (Excel UTF-8) or .json file.");
      return;
    }
    setError(null);
    setFileName(f.name);
    setCsvOrJsonFormat(lower.endsWith(".json") ? "json" : "csv");
    setTextContent(await f.text());
  };

  const handleMediaPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const validMimes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!validMimes.includes(f.type)) {
      setError("Please upload a PDF (.pdf) or Image (.png, .jpg, .webp) question paper.");
      return;
    }
    setError(null);
    setFileName(f.name);
    setMediaMime(f.type as typeof mediaMime);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      setMediaBase64(base64);
    };
    reader.readAsDataURL(f);
  };

  const downloadExamTemplate = () => {
    if (!tree || tree.subjects.length === 0) {
      downloadCsv(
        `${exam.slug}-question-set-template.csv`,
        toCsv(BULK_IMPORT_TEMPLATE_EXAMPLES, BULK_IMPORT_CSV_COLUMNS)
      );
      return;
    }
    const rows = tree.subjects.flatMap((s) =>
      s.chapters.slice(0, 2).flatMap((c) =>
        c.subtopics.slice(0, 2).map((st) => ({
          exam: exam.slug,
          subject: s.name.en,
          chapter: c.name.en,
          subtopic: st.name.en,
          stem_en: "",
          stem_bn: "",
          option_a_en: "",
          option_a_bn: "",
          option_b_en: "",
          option_b_bn: "",
          option_c_en: "",
          option_c_bn: "",
          option_d_en: "",
          option_d_bn: "",
          correct_option: "A",
          explanation_en: "",
          explanation_bn: "",
          difficulty: "moderate",
          source: "educator",
        }))
      )
    );
    downloadCsv(`${exam.slug}-question-set-template.csv`, toCsv(rows, BULK_IMPORT_CSV_COLUMNS));
  };

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload =
        mode === "csv"
          ? {
              format: csvOrJsonFormat,
              fileName,
              content: textContent,
              source: "educator" as const,
              autoUpdateBlueprint,
            }
          : {
              format: "media" as const,
              fileName,
              mimeType: mediaMime,
              base64Data: mediaBase64,
              source: "educator" as const,
              autoUpdateBlueprint,
            };

      const res = await adminApi<SeriesImportSetResult>(`/series/${series.id}/import-set`, {
        method: "POST",
        body: payload,
      });
      setResult(res);
      await onImported(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    ((mode === "csv" && textContent.trim().length > 0) ||
      (mode === "media" && mediaBase64.length > 0));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileUp className="w-4 h-4 text-sky-400" />
              Import Whole Question Set into “{series.name.en}”
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Upload a complete question set for <strong>{exam.titleEn}</strong>. Questions are
              automatically translated (if Bengali is left blank), saved to the{" "}
              <strong>{exam.titleEn}</strong> Question Bank, and assigned directly to this Test
              Series.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("csv");
              setError(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
              mode === "csv"
                ? "bg-sky-500/15 border-sky-400 text-white"
                : "bg-slate-950 border-slate-800 text-slate-400"
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-sky-300" />
            Excel / CSV / JSON Question Set
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("media");
              setError(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
              mode === "media"
                ? "bg-violet-500/15 border-violet-400 text-white"
                : "bg-slate-950 border-slate-800 text-slate-400"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-violet-300" />
            PDF / Image Question Paper (AI Extract)
          </button>
          <button
            type="button"
            onClick={downloadExamTemplate}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> CSV Template
          </button>
        </div>

        {mode === "csv" ? (
          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-700 hover:border-sky-500/60 rounded-xl cursor-pointer text-center bg-slate-950/60">
            <Upload className="w-6 h-6 text-sky-400" />
            <span className="text-xs text-slate-200 font-medium">
              {fileName || "Choose a .csv (Excel UTF-8) or .json file containing the question set"}
            </span>
            <span className="text-[11px] text-slate-400">
              Bengali columns are optional — if left blank, AI translates them into বাংলা automatically.
            </span>
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={handleCsvOrJsonPick}
              disabled={busy}
              className="hidden"
            />
          </label>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-700 hover:border-violet-500/60 rounded-xl cursor-pointer text-center bg-slate-950/60">
            <FileUp className="w-6 h-6 text-violet-400" />
            <span className="text-xs text-slate-200 font-medium">
              {fileName || "Choose a Question Paper PDF (.pdf) or Image (.png, .jpg, .webp)"}
            </span>
            <span className="text-[11px] text-slate-400">
              AI extracts every MCQ, classifies it by Subject &amp; Topic, provides bilingual text, and attaches it to this test.
            </span>
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp,application/pdf"
              onChange={handleMediaPick}
              disabled={busy}
              className="hidden"
            />
          </label>
        )}

        {series.status !== "published" && (
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={autoUpdateBlueprint}
              onChange={(e) => setAutoUpdateBlueprint(e.target.checked)}
              disabled={busy}
            />
            Automatically adjust this series' subject counts (blueprint) to fit the imported question set
          </label>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
            {error}
          </div>
        )}

        {result && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 space-y-1.5">
            <p className="font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Imported {result.insertedToBank} question(s) into {exam.titleEn} bank &amp; assigned{" "}
              {result.assignedToSeries} to “{series.name.en}”!
            </p>
            {result.reusedFromBank > 0 && (
              <p className="text-slate-300">
                • {result.reusedFromBank} existing question(s) from the bank were matched &amp; reused.
              </p>
            )}
            {result.errors.length > 0 && (
              <ul className="list-disc pl-4 text-amber-200 max-h-28 overflow-y-auto">
                {result.errors.map((er, idx) => (
                  <li key={idx}>
                    Row {er.rowNumber}: {er.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={btn.secondary}>
            {result ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!canSubmit}
            className={btn.primary}
          >
            <Upload className="w-3.5 h-3.5" />
            {busy ? "Importing & Translating…" : "Import Question Set into Test"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3. FullSetAiGeneratorPanel — 1-Click Full Question Set by AI (Subject-wise)
// ============================================================================

export function FullSetAiGeneratorPanel({
  exam,
  tree,
  series = null,
  onGenerated,
  onClose,
}: {
  exam: ExamDto;
  tree: SyllabusTreeDto | undefined;
  series?: SeriesDto | null;
  onGenerated: (res: GenerateFullQuestionSetResult) => Promise<void> | void;
  onClose?: () => void;
}) {
  // Determine initial per-subject counts keyed by subjectId from:
  // 1) Series blueprint subject targets (if inside a series that already has subjects)
  // 2) Exam's subject weightageQuestions (set by Admin during Exam creation / editing)
  // 3) Official WBPSC preset for this exam slug
  // 4) Evenly distributed across the exam's subjects totaling exam.totalQuestions
  const initialCounts = useMemo(() => {
    const map: Record<string, string> = {};
    if (!tree || tree.subjects.length === 0) return map;

    if (series && series.subjects.length > 0) {
      for (const slot of series.subjects) {
        if (slot.targetCount > 0) {
          map[slot.subjectId] = String(slot.targetCount);
        }
      }
      if (Object.keys(map).length > 0) return map;
    }

    const hasConfiguredWeightages = tree.subjects.some((s) => (s.weightageQuestions ?? 0) > 0);
    if (hasConfiguredWeightages) {
      for (const s of tree.subjects) {
        if ((s.weightageQuestions ?? 0) > 0) {
          map[s.id] = String(s.weightageQuestions);
        }
      }
      return map;
    }

    // Check preset matching exam slug
    const preset = WBPSC_EXAM_PRESETS.find((p) => p.slug === exam.slug);
    if (preset?.subjectWeightages) {
      for (const sw of preset.subjectWeightages) {
        const match = tree.subjects.find(
          (s) => s.name.en.toLowerCase() === sw.subjectEn.toLowerCase()
        );
        if (match && sw.weightageQuestions > 0) {
          map[match.id] = String(sw.weightageQuestions);
        }
      }
      if (Object.keys(map).length > 0) return map;
    }

    // Otherwise split exam.totalQuestions across existing subjects
    const total = exam.totalQuestions || 100;
    const perSubj = Math.max(1, Math.floor(total / tree.subjects.length));
    let remainder = total - perSubj * tree.subjects.length;
    for (const s of tree.subjects) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      map[s.id] = String(perSubj + extra);
    }
    return map;
  }, [exam.slug, exam.totalQuestions, series, tree]);

  const [subjectCounts, setSubjectCounts] = useState<Record<string, string>>(initialCounts);
  const [difficulty, setDifficulty] = useState<"easy" | "moderate" | "hard" | "mixed">("mixed");
  const [insertDirectlyToBank, setInsertDirectlyToBank] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateFullQuestionSetResult | null>(null);

  useEffect(() => {
    setSubjectCounts(initialCounts);
  }, [initialCounts]);

  const subjects = tree?.subjects ?? [];

  const totalSelectedQuestions = useMemo(
    () =>
      Object.values(subjectCounts).reduce((sum, val) => {
        const n = Number(val);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [subjectCounts]
  );

  const toggleSubject = (subjectId: string, defaultCount = 25) => {
    setSubjectCounts((prev) => {
      const next = { ...prev };
      if (next[subjectId] !== undefined) {
        delete next[subjectId];
      } else {
        next[subjectId] = String(defaultCount);
      }
      return next;
    });
  };

  const resetToExamDefault = () => {
    setSubjectCounts(initialCounts);
  };

  const handleGenerateFullSet = async () => {
    const subjectsPayload = Object.entries(subjectCounts)
      .map(([subjectId, countStr]) => ({
        subjectId,
        count: Number(countStr),
      }))
      .filter((s) => Number.isFinite(s.count) && s.count > 0);

    if (subjectsPayload.length === 0) {
      setError("Please select at least one subject and set its question count.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await adminApi<GenerateFullQuestionSetResult>("/ingestion/generate-full-set", {
        method: "POST",
        body: {
          examSlug: exam.slug,
          seriesId: series?.id ?? null,
          difficulty,
          insertDirectlyToBank,
          syncSeriesBlueprint: true,
          subjects: subjectsPayload,
        },
      });
      setResult(res);
      await onGenerated(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-violet-500/40 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-300" />
            1-Click AI Full Question Set Generator ({exam.titleEn})
          </h3>
          <p className="text-xs text-slate-300 mt-1 max-w-3xl">
            Generate a complete exam question paper (e.g., <strong>{exam.totalQuestions} questions</strong>{" "}
            for <strong>{exam.titleEn}</strong>) across your chosen subjects in a single click. Adjust
            how many questions AI should generate for each subject below.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {subjects.length === 0 ? (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
          This exam has no subjects in its syllabus yet. Please open <strong>2. Exams &amp; Syllabus</strong>{" "}
          to configure subjects or generate the syllabus with AI first.
        </div>
      ) : (
        <>
          {/* Subject Selection & Question Count Grid */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-white">
                Choose Subjects &amp; Questions per Subject:
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={resetToExamDefault}
                  disabled={busy}
                  className="text-violet-300 hover:underline cursor-pointer"
                >
                  Reset to Exam Pattern ({exam.totalQuestions} Qs)
                </button>
                <button
                  type="button"
                  onClick={() => setSubjectCounts({})}
                  disabled={busy}
                  className="text-slate-400 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {subjects.map((s) => {
                const isSelected = subjectCounts[s.id] !== undefined;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border text-xs transition-colors ${
                      isSelected
                        ? "bg-violet-500/15 border-violet-400/50 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-400"
                    }`}
                  >
                    <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={busy}
                        onChange={() =>
                          toggleSubject(
                            s.id,
                            (s.weightageQuestions ?? 0) > 0 ? s.weightageQuestions! : 25
                          )
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <span className="block font-medium truncate">{s.name.en}</span>
                        {s.name.bn && (
                          <span className="block text-[11px] font-bengali text-slate-400 truncate">
                            {s.name.bn}
                          </span>
                        )}
                      </div>
                    </label>
                    {isSelected && (
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={1}
                          max={200}
                          disabled={busy}
                          aria-label={`Questions for ${s.name.en}`}
                          value={subjectCounts[s.id]}
                          onChange={(e) =>
                            setSubjectCounts((prev) => ({
                              ...prev,
                              [s.id]: e.target.value.replace(/[^\d]/g, ""),
                            }))
                          }
                          className="w-16 px-2 py-1 text-xs text-right font-mono bg-slate-950 border border-violet-400/40 rounded text-white"
                        />
                        <span className="text-[11px] text-slate-300">Qs</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Controls & Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <span>Difficulty:</span>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                  disabled={busy}
                  className={`${inputCls} w-44`}
                >
                  <option value="mixed">Mixed (Official Exam Level)</option>
                  <option value="easy">Easy</option>
                  <option value="moderate">Moderate</option>
                  <option value="hard">Hard</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={insertDirectlyToBank}
                  onChange={(e) => setInsertDirectlyToBank(e.target.checked)}
                  disabled={busy}
                />
                {series
                  ? `Insert directly into Live Bank & assign to “${series.name.en}”`
                  : "Insert directly into Live Question Bank (skip manual review queue)"}
              </label>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="block text-[11px] text-slate-400">Total to Generate</span>
                <span className="text-sm font-mono font-bold text-emerald-300">
                  {totalSelectedQuestions} Questions
                </span>
              </div>

              <button
                type="button"
                onClick={handleGenerateFullSet}
                disabled={busy || totalSelectedQuestions === 0}
                className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white rounded-lg cursor-pointer shadow-lg"
              >
                <Sparkles className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
                {busy
                  ? `Generating ${totalSelectedQuestions} Questions with AI…`
                  : `Generate Full ${totalSelectedQuestions}-Question Set Now`}
              </button>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="p-4 rounded-xl bg-emerald-950/25 border border-emerald-500/40 text-xs space-y-2">
          <p className="font-bold text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            Generated {result.totalGenerated} of {result.totalRequested} bilingual questions
            {result.totalInsertedLive > 0 ? ` · ${result.totalInsertedLive} live in Question Bank` : ""}
            {result.totalAssignedToSeries > 0
              ? ` · ${result.totalAssignedToSeries} assigned to Test Series`
              : ""}
            !
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
            {result.subjectSummaries.map((ps) => (
              <div
                key={ps.subjectId}
                className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between"
              >
                <span className="text-slate-200 truncate pr-2">{ps.subjectNameEn}</span>
                <span className="font-mono text-emerald-300 shrink-0">
                  {ps.generated}/{ps.requested} Qs
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
