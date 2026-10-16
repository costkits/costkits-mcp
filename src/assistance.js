// Hospital financial assistance (charity care) screening: where a household's income sits against the
// U.S. federal poverty guidelines, plus what federal rules do and do not guarantee.
//
// This is deliberately NOT an eligibility decision: every hospital writes its own policy. Nothing here is
// specific to a hospital or a state, and no income or household data is stored or logged.

export const FPG_YEAR = 2026;

// HHS poverty guidelines, annual dollars: [first person, each additional person].
// 48 contiguous states + DC are the official HHS/ASPE figures; Alaska and Hawaii were taken from a secondary
// source and cross-checked against Legal Services Corporation figures. Re-verify against aspe.hhs.gov
// every January (HHS republishes them annually).
const FPG = {
  std: [15960, 5680],
  AK: [19950, 7100],
  HI: [18360, 6530],
};

export function povertyGuideline(householdSize, state) {
  const [first, extra] = FPG[String(state || "").toUpperCase()] ?? FPG.std;
  return first + extra * (householdSize - 1);
}

export function screenFinancialAssistance({ household_size, annual_household_income, state }) {
  const fpg = povertyGuideline(household_size, state);
  const pct = Math.round((annual_household_income / fpg) * 100);

  let band;
  if (pct <= 200) {
    band = "Many hospital financial assistance policies provide free or heavily discounted care in this range.";
  } else if (pct <= 400) {
    band = "Many policies offer sliding-scale discounts in this range, often up to about 300% to 400% of the poverty guidelines; some go higher and some stop lower.";
  } else {
    band = "Discounts at this income are less common, but some hospitals and some state rules cover higher incomes, and some policies add relief when a bill is very large compared with income.";
  }

  return {
    guidelines_year: FPG_YEAR,
    household_size,
    federal_poverty_guideline_100pct: fpg,
    income_as_percent_of_guideline: pct,
    typical_pattern: band,
    pattern_note: "This describes typical hospital policies, not the rules of any specific hospital. Each hospital sets its own income limits, what counts as income, and how a household is defined.",
    what_federal_rules_provide: [
      "Tax-exempt (nonprofit) hospitals must have a written financial assistance policy and make it widely available (IRS Section 501(r)). Government and for-profit hospitals are not covered by that rule, though many have similar programs.",
      "Federal rules set no income threshold; the hospital's own policy does.",
      "A hospital must give at least 240 days after the first billing statement to apply for assistance.",
      "A hospital generally must make reasonable efforts to determine eligibility before taking extraordinary collection actions such as reporting to credit bureaus or suing.",
      "Patients who qualify generally cannot be charged more than what the hospital typically accepts from insured patients for the same care.",
    ],
    next_steps: [
      "Ask the hospital billing office for its financial assistance policy and application, in writing, and for the application deadline.",
      "Ask that the bill be put on hold while the application is reviewed.",
      "Request an itemized bill and check it for errors before applying, since assistance is calculated from the billed amount.",
      "Keep copies of every document and note the date and name of each person you speak with.",
    ],
    disclaimer: "General information, not legal, medical or financial advice. This is a screening estimate and does not guarantee eligibility or any discount.",
  };
}
