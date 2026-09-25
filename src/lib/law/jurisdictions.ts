/**
 * U.S. jurisdictions → CourtListener court IDs (https://www.courtlistener.com/help/api/jurisdictions/).
 * The first IDs of every list are the state's highest court and its main intermediate appellate court;
 * they're used on their own if CourtListener ever rejects one of the longer lists.
 * Selecting a state searches that state's courts only. "Federal" searches the U.S. Supreme Court,
 * the federal courts of appeals, the district courts and the national federal trial courts.
 */
export const STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
  "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

export const JURISDICTIONS = ["Federal", ...STATES] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

const STATE_COURTS: Record<(typeof STATES)[number], string[]> = {
  Alabama: ["ala", "alactapp", "alacrimapp", "alacivapp"],
  Alaska: ["alaska", "alaskactapp"],
  Arizona: ["ariz", "arizctapp", "ariztaxct"],
  Arkansas: ["ark", "arkctapp"],
  California: ["cal", "calctapp", "calappdeptsuper"],
  Colorado: ["colo", "coloctapp"],
  Connecticut: ["conn", "connappct", "connsuperct"],
  Delaware: ["del", "delsuperct", "delch", "delfamct"],
  Florida: ["fla", "fladistctapp"],
  Georgia: ["ga", "gactapp"],
  Hawaii: ["haw", "hawapp"],
  Idaho: ["idaho", "idahoctapp"],
  Illinois: ["ill", "illappct"],
  Indiana: ["ind", "indctapp", "indtc"],
  Iowa: ["iowa", "iowactapp"],
  Kansas: ["kan", "kanctapp"],
  Kentucky: ["ky", "kyctapp"],
  Louisiana: ["la", "lactapp"],
  Maine: ["me"],
  Maryland: ["md", "mdctspecapp"],
  Massachusetts: ["mass", "massappct"],
  Michigan: ["mich", "michctapp"],
  Minnesota: ["minn", "minnctapp"],
  Mississippi: ["miss", "missctapp"],
  Missouri: ["mo", "moctapp"],
  Montana: ["mont"],
  Nebraska: ["neb", "nebctapp"],
  Nevada: ["nev", "nevapp"],
  "New Hampshire": ["nh"],
  "New Jersey": ["nj", "njsuperctappdiv", "njtaxct"],
  "New Mexico": ["nm", "nmctapp"],
  "New York": ["ny", "nyappdiv", "nyappterm", "nysupct"],
  "North Carolina": ["nc", "ncctapp"],
  "North Dakota": ["nd", "ndctapp"],
  Ohio: ["ohio", "ohioctapp"],
  Oklahoma: ["okla", "oklacivapp", "oklacrimapp"],
  Oregon: ["or", "orctapp"],
  Pennsylvania: ["pa", "pasuperct", "pacommwct"],
  "Rhode Island": ["ri"],
  "South Carolina": ["sc", "scctapp"],
  "South Dakota": ["sd"],
  Tennessee: ["tenn", "tennctapp", "tenncrimapp"],
  Texas: ["tex", "texapp", "texcrimapp"],
  Utah: ["utah", "utahctapp"],
  Vermont: ["vt"],
  Virginia: ["va", "vactapp"],
  Washington: ["wash", "washctapp"],
  "West Virginia": ["wva"],
  Wisconsin: ["wis", "wisctapp"],
  Wyoming: ["wyo"],
};

const FEDERAL_APPELLATE = ["scotus", "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"];
const FEDERAL_DISTRICT = [
  "almd", "alnd", "alsd", "akd", "azd", "ared", "arwd", "cacd", "caed", "cand", "casd", "cod", "ctd", "ded", "dcd",
  "flmd", "flnd", "flsd", "gamd", "gand", "gasd", "hid", "idd", "ilcd", "ilnd", "ilsd", "innd", "insd", "iand", "iasd",
  "ksd", "kyed", "kywd", "laed", "lamd", "lawd", "med", "mdd", "mad", "mied", "miwd", "mnd", "msnd", "mssd", "moed",
  "mowd", "mtd", "ned", "nvd", "nhd", "njd", "nmd", "nyed", "nynd", "nysd", "nywd", "nced", "ncmd", "ncwd", "ndd",
  "ohnd", "ohsd", "oked", "oknd", "okwd", "ord", "paed", "pamd", "pawd", "rid", "scd", "sdd", "tned", "tnmd", "tnwd",
  "txed", "txnd", "txsd", "txwd", "utd", "vtd", "vaed", "vawd", "waed", "wawd", "wvnd", "wvsd", "wied", "wiwd", "wyd",
  "prd", "gud", "nmid", "vid",
];
const FEDERAL_SPECIAL = ["cit", "uscfc"];

/** All CourtListener court IDs for a jurisdiction. */
export function courtsFor(j: Jurisdiction): string[] {
  return j === "Federal" ? [...FEDERAL_APPELLATE, ...FEDERAL_DISTRICT, ...FEDERAL_SPECIAL] : STATE_COURTS[j];
}

/** Highest courts only — the retry list if CourtListener rejects the full list. */
export function coreCourtsFor(j: Jurisdiction): string[] {
  return j === "Federal" ? FEDERAL_APPELLATE : STATE_COURTS[j].slice(0, 2);
}

/** Label used in prompts and the UI ("California state courts", "federal courts"). */
export const jurisdictionLabel = (j: Jurisdiction) => (j === "Federal" ? "U.S. federal courts" : `${j} state courts`);
