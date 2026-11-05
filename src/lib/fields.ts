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
  /** Titles the pattern would catch that aren't this field. */
  not?: RegExp;
  /** Offered as tap-to-add suggestions in setup. */
  skills: string[];
}

export const FIELDS: Field[] = [
  {
    id: "it",
    label: "IT & software",
    terms: ["Software", "Entwickler", "Sviluppatore", "Informatik"],
    pattern: /software|developer|entwickler|sviluppator|programmier|informati|\bit[- ](?:support|admin|techni|speziali|specialist)|system(?:admin|techni)|devops|data engineer|\bweb.?(?:develop|entwick|design|master)|front.?end|back.?end|full.?stack/i,
    not: /vertrieb|\bsales\b|verkäufer|außendienst/i,
    skills: ["JavaScript", "TypeScript", "Python", "Java", "C#", "SQL", "React", "Git", "Linux", "Windows", "IT Support", "Networking"],
  },
  {
    id: "frontdesk",
    label: "Reception & customer service",
    terms: ["Rezeption", "Receptionist", "Kundenservice", "Helpdesk"],
    pattern: /rezeption|receptionist|ricevimento|empfang|portier|concierge|front.?(?:office|desk)|help.?desk|service.?desk|kundenservice|kundendienst|customer.?(?:service|support|care)|call.?cent|assistenza clienti/i,
    not: /techniker|monteur|montage|reparatur|installation/i,
    skills: ["Customer service", "Phone support", "Reception", "Microsoft Office", "Booking systems", "Ticketing"],
  },
  {
    id: "hospitality",
    label: "Hotels & restaurants",
    terms: ["Hotel", "Koch", "Kellner", "Rezeption"],
    pattern: /hotel|\bkoch\b|köchin|küche|kellner|service(?:mitarbeiter|kraft)|cuoc[oa]|camerier|barista|gastronom|restaurant|kitchen|\bcook\b|waiter|waitress|lavapiatti|tellerwäscher|pizzaiol|barman|barkeeper/i,
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
    id: "retail",
    label: "Supermarket & shops",
    terms: ["Supermarkt", "Verkäufer", "Commesso", "Kassier"],
    pattern: /supermarket|supermarkt|supermercato|verkäufer|verkaufsmitarbeit|verkaufskraft|verkaufshilfe|mitarbeiter.{0,8}verkauf|\bverkauf\b|kassier|cassier|cashier|commess|filial|regal|scaffal|lebensmittel|einzelhandel|detailhandel|discount|negozio|\bshop\b|retail|addett[oa].{0,8}vendit|metzger|macell|bäcker|panett|feinkost|salumi/i,
    not: /außendienst|aussendienst|maschinenbau|baumaschin|\bsales\b|vertrieb|kundenberat|\bbank\b|versicher/i,
    skills: ["Customer service", "Cash handling", "Stocking shelves", "Food handling", "Working in a team"],
  },
  {
    id: "sales",
    label: "Sales & account management",
    terms: ["Vertrieb", "Sales", "Außendienst", "Commerciale"],
    pattern: /vertrieb|außendienst|aussendienst|\bsales\b|key.?account|account.?manag|business.?develop|handelsvertret|\bagente\b|venditor|commerciale|verkaufsleit|verkaufsinnen|verkaufsau|verkaufsberat|kundenberat|(?:verkauf|verkäufer).*(?:maschinenbau|baumaschin)/i,
    skills: ["Sales", "Negotiation", "CRM", "Key accounts"],
  },
  {
    id: "cleaning",
    label: "Cleaning & caretaking",
    terms: ["Reinigung", "Pulizie", "Housekeeping", "Hausmeister"],
    pattern: /reinig|pulizi|housekeeping|zimmermädchen|zimmerfrau|cameriere ai piani|facility|hausmeister|custode|cleaner|cleaning|janitor/i,
    skills: ["Cleaning", "Housekeeping", "Reliable", "Working alone"],
  },
  {
    id: "outdoor",
    label: "Farm & outdoor work",
    terms: ["Landwirtschaft", "Agricoltura", "Erntehelfer", "Gärtner"],
    pattern: /landwirt|agricol|ernte|obstbau|frutticol|weinbau|vigna|gärtner|giardinier|forst|förster|\bfarm\b|gardener|alm\b/i,
    skills: ["Physical work", "Machine operation", "Working outdoors", "Driving licence B"],
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
    pattern: /produktion|produzion|\blager|magazzin|magazineur|logisti|operai|fahrer|autista|staplerfahrer|montator|maschinenführer|\blkw\b|hilfsarbeit|hilfskraft|warehouse|\bdriver\b|forklift|factory|versand|spedizion/i,
    not: /kundendienst/i,
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

/** Whether a job title belongs to this field. */
export const inField = (f: Field, text: string) => f.pattern.test(text) && !f.not?.test(text);

export const fieldsIn = (text: string) => FIELDS.filter((f) => inField(f, text));

/** What someone wants: fields they picked, plus any their job titles belong to ("cashier"). */
export function wantedFields(person: { fields: string[]; roles: string[] }): Field[] {
  const out = person.fields.map(fieldById).filter((f): f is Field => !!f);
  for (const role of person.roles) for (const f of fieldsIn(role)) if (!out.includes(f)) out.push(f);
  return out;
}
