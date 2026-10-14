/**
 * PICO question and literature-search builders. Each PICO element is a set of
 * synonym "pieces": synonyms are OR-ed inside an element, elements are AND-ed
 * together — the standard Boolean block structure of a systematic search.
 */

export type PicoKey = "population" | "intervention" | "comparison" | "outcome";
export type TermField = "tiab" | "mesh" | "all";

export interface PicoTerm {
  text: string;
  field: TermField;
}

export interface Pico {
  population: PicoTerm[];
  intervention: PicoTerm[];
  comparison: PicoTerm[];
  outcome: PicoTerm[];
  timeframe: string;
}

export interface SearchFilters {
  humans: boolean;
  english: boolean;
  /** Restrict to a publication type, e.g. randomized controlled trials. */
  design: "" | "rct" | "systematic_review" | "cohort";
  yearFrom: number | null;
}

export const EMPTY_PICO: Pico = { population: [], intervention: [], comparison: [], outcome: [], timeframe: "" };

export const PICO_LABELS: Record<PicoKey, { letter: string; label: string; hint: string }> = {
  population: { letter: "P", label: "Population", hint: "Who? e.g. adults with type 2 diabetes" },
  intervention: { letter: "I", label: "Intervention / exposure", hint: "What is done or encountered? e.g. SGLT2 inhibitors" },
  comparison: { letter: "C", label: "Comparison", hint: "Against what? e.g. placebo, usual care (optional in the search)" },
  outcome: { letter: "O", label: "Outcome", hint: "What changes? e.g. heart failure hospitalisation" },
};

/** Quotes multi-word phrases and attaches the PubMed field tag. */
export function formatTerm(term: PicoTerm): string {
  const text = term.text.trim().replace(/"/g, "");
  if (!text) return "";
  // PubMed supports truncation inside quoted phrases, so multi-word terms are always quoted.
  const phrase = /\s/.test(text) ? `"${text}"` : text;
  if (term.field === "mesh") return `${phrase}[MeSH Terms]`;
  if (term.field === "tiab") return `${phrase}[tiab]`;
  return phrase;
}

function block(terms: PicoTerm[]): string {
  const parts = terms.map(formatTerm).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

const DESIGN_FILTER: Record<Exclude<SearchFilters["design"], "">, string> = {
  rct: "randomized controlled trial[pt]",
  systematic_review: "systematic review[pt]",
  cohort: '"cohort studies"[MeSH Terms]',
};

/**
 * The PubMed query. The comparison is usually left out of the search on
 * purpose (it narrows recall), so it is included only when asked.
 */
export function buildPubmedQuery(pico: Pico, filters: SearchFilters, includeComparison = false): string {
  const blocks = [block(pico.population), block(pico.intervention), includeComparison ? block(pico.comparison) : "", block(pico.outcome)].filter(Boolean);
  // Filters alone are not a search: without any PICO term there is no query.
  if (blocks.length === 0) return "";
  if (filters.design) blocks.push(DESIGN_FILTER[filters.design]);
  // The Cochrane-style hedge keeps recent, not-yet-indexed records that a plain humans[MeSH] would drop.
  if (filters.humans) blocks.push("NOT (animals[MeSH Terms] NOT humans[MeSH Terms])");
  if (filters.english) blocks.push("english[la]");
  if (filters.yearFrom) blocks.push(`("${filters.yearFrom}"[dp] : "3000"[dp])`);
  return blocks.join(" AND ").replace(" AND NOT (", " NOT (");
}

export function pubmedUrl(query: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}

export function clinicalTrialsUrl(pico: Pico): string {
  const params = new URLSearchParams();
  const first = (terms: PicoTerm[]) => terms.map((term) => term.text.trim()).filter(Boolean).join(" OR ");
  if (pico.population.length) params.set("cond", first(pico.population));
  if (pico.intervention.length) params.set("intr", first(pico.intervention));
  if (pico.outcome.length) params.set("outc", first(pico.outcome));
  return `https://clinicaltrials.gov/search?${params.toString()}`;
}

/** A readable structured question from the first term of each element. */
export function structuredQuestion(pico: Pico): string {
  const lead = (terms: PicoTerm[]) => terms[0]?.text.trim() ?? "";
  const p = lead(pico.population);
  const i = lead(pico.intervention);
  const c = lead(pico.comparison);
  const o = lead(pico.outcome);
  if (!p && !i && !o) return "";
  return `In ${p || "[population]"}, does ${i || "[intervention]"}${c ? ` compared with ${c}` : ""} affect ${o || "[outcome]"}${pico.timeframe.trim() ? ` over ${pico.timeframe.trim()}` : ""}?`;
}
