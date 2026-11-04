/**
 * Fields of work. Local postings are in German, Italian or English, so each
 * field carries search terms and title patterns in all three, whatever language
 * the user describes themselves in.
 */
export interface Field {
  id: string;
  label: string;
  /** Sent to the job sites as search terms. */
  terms: string[];
  /** Recognises the field in a job title or posting. */
  pattern: RegExp;
  /** Offered as tap-to-add suggestions in setup. */
  skills: string[];
}

export const FIELDS: Field[] = [
  {
    id: "it",
    label: "IT & software",
    terms: ["Software", "Entwickler", "Sviluppatore", "Informatik"],
    pattern: /software|developer|entwickl|sviluppator|programm|informati|\bit[- ](?:support|admin|techni|speziali|specialist)|system(?:admin|techni)|devops|data engineer|web/i,
    skills: ["JavaScript", "TypeScript", "Python", "Java", "C#", "SQL", "React", "Git", "Linux", "Windows", "IT Support", "Networking"],
  },
  {
    id: "hospitality",
    label: "Hotels & restaurants",
    terms: ["Hotel", "Koch", "Kellner", "Rezeption"],
    pattern: /hotel|\bkoch\b|köchin|küche|kellner|service(?:mitarbeiter|kraft)|rezeption|cuoc[oa]|camerier|receptionist|ricevimento|barista|housekeeping|zimmermädchen|gastronom/i,
    skills: ["Guest service", "Cooking", "Reception", "Serving", "Housekeeping", "Bar", "HACCP"],
  },
  {
    id: "health",
    label: "Health & care",
    terms: ["Pflege", "Infermiere", "Krankenpfleger", "Arzt"],
    pattern: /pflege|krankenpfleg|infermier|\barzt\b|ärztin|medic[oa]|physiotherap|fisioterap|apothek|farmaci|oss\b|sanitari|altenheim/i,
    skills: ["Patient care", "Elderly care", "First aid", "Nursing", "Physiotherapy"],
  },
  {
    id: "office",
    label: "Office & admin",
    terms: ["Verwaltung", "Sekretariat", "Impiegato", "Sachbearbeiter"],
    pattern: /verwaltung|sekretari|sachbearbeit|büro|impiegat|segreteri|amministra|office|assistenz|back office|\bhr\b|personal(?:wesen|verwaltung|administration)/i,
    skills: ["Microsoft Office", "Excel", "Correspondence", "Customer contact", "Scheduling"],
  },
  {
    id: "finance",
    label: "Finance & accounting",
    terms: ["Buchhaltung", "Contabile", "Controlling", "Finance"],
    pattern: /buchhalt|contabil|controlling|finanz|finance|accounting|bilanz|steuer|banca|\bbank\b|credit|revision/i,
    skills: ["Accounting", "Excel", "SAP", "Controlling", "Payroll", "Tax"],
  },
  {
    id: "sales",
    label: "Sales & retail",
    terms: ["Verkauf", "Vendita", "Commesso", "Sales"],
    pattern: /verkauf|vendit|commess|\bsales\b|kundenberat|filial|einzelhandel|retail|negozio|kassier|cassier/i,
    skills: ["Sales", "Customer service", "Negotiation", "Cash handling", "CRM"],
  },
  {
    id: "marketing",
    label: "Marketing & design",
    terms: ["Marketing", "Grafik", "Social Media", "Kommunikation"],
    pattern: /marketing|grafik|grafic|design|social media|kommunikation|comunicazione|content|redakt|ufficio stampa/i,
    skills: ["Social media", "Photoshop", "Illustrator", "Copywriting", "SEO", "Figma"],
  },
  {
    id: "engineering",
    label: "Engineering",
    terms: ["Ingenieur", "Ingegnere", "Techniker", "Konstrukteur"],
    pattern: /ingenieur|ingegner|engineer|technik|tecnico|konstrukt|cad\b|elektronik|elettronic|mechatron|meccatron|maschinenbau/i,
    skills: ["CAD", "AutoCAD", "SolidWorks", "Electronics", "Project management", "PLC"],
  },
  {
    id: "trades",
    label: "Trades & construction",
    terms: ["Handwerker", "Elektriker", "Muratore", "Installateur"],
    pattern: /handwerk|elektrik|elettricist|maurer|murator|installateur|idraulic|tischler|falegnam|maler|imbianchin|schlosser|\bbau\b|edil|schweiß|saldator|mechanik|meccanic/i,
    skills: ["Electrical work", "Plumbing", "Carpentry", "Welding", "Driving licence B", "Reading plans"],
  },
  {
    id: "production",
    label: "Production & warehouse",
    terms: ["Produktion", "Lager", "Magazziniere", "Fahrer"],
    pattern: /produktion|produzion|\blager|magazzin|logisti|operai|fahrer|autista|staplerfahrer|montage|montator|maschinenführer|lkw/i,
    skills: ["Forklift", "Driving licence C", "Machine operation", "Quality control", "Shipping"],
  },
  {
    id: "education",
    label: "Education & social",
    terms: ["Lehrer", "Insegnante", "Sozial", "Erzieher"],
    pattern: /lehr(?:er|kraft|person)|insegnant|erzieh|educator|sozial|social[ei]|kindergart|asilo|betreu|ausbild|formator|universit/i,
    skills: ["Teaching", "Childcare", "Counselling", "Tutoring", "Group work"],
  },
];

export const fieldById = (id: string) => FIELDS.find((f) => f.id === id);
