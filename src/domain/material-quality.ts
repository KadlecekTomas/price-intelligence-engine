export type GarmentProfile =
  | "tops"
  | "knitwear"
  | "denim"
  | "outerwear"
  | "sportswear"
  | "other";

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function inferGarmentProfile(text: string): GarmentProfile {
  const value = text.toLocaleLowerCase("cs-CZ");

  if (/(sportovní|běžeck|trénink|funkční|fitness|golf|outdoor)/i.test(value)) {
    return "sportswear";
  }
  if (/(svetr|rolák|kardigan|pulovr)/i.test(value)) {
    return "knitwear";
  }
  if (/(džíny|denim)/i.test(value)) {
    return "denim";
  }
  if (/(bunda|kabát|parka|vesta)/i.test(value)) {
    return "outerwear";
  }
  if (/(tričko|košile|polo|halenka)/i.test(value)) {
    return "tops";
  }

  return "other";
}

export function scoreMaterialQuality(productText: string, material: string | null) {
  if (!material) {
    return {
      score: null as number | null,
      signals: [] as string[],
      profile: inferGarmentProfile(productText),
    };
  }

  const profile = inferGarmentProfile(productText);
  const value = material.toLocaleLowerCase("cs-CZ");
  let score = 55;
  const signals: string[] = [`profil:${profile}`];

  const reward = (pattern: RegExp, points: number, signal: string) => {
    if (pattern.test(value)) {
      score += points;
      signals.push(signal);
    }
  };

  const penalize = (pattern: RegExp, points: number, signal: string) => {
    if (pattern.test(value)) {
      score -= points;
      signals.push(signal);
    }
  };

  reward(/kašmír|cashmere/, profile === "knitwear" ? 35 : 28, "kašmír");
  reward(/merino/, profile === "sportswear" || profile === "knitwear" ? 30 : 24, "merino");
  reward(/vlna|wool/, profile === "outerwear" || profile === "knitwear" ? 26 : 18, "vlna");
  reward(/len|linen/, profile === "tops" ? 24 : 18, "len");
  reward(/lyocell|tencel/, 15, "lyocell/Tencel");
  reward(/modal/, 11, "modal");
  reward(/kůže|leather/, profile === "outerwear" ? 24 : 18, "kůže");

  if (/100\s*%\s*(bavlna|cotton)/.test(value)) {
    score += profile === "tops" ? 22 : profile === "denim" ? 16 : 10;
    signals.push("100% bavlna");
  } else if (/bavlna|cotton/.test(value)) {
    score += profile === "tops" || profile === "denim" ? 10 : 5;
    signals.push("obsahuje bavlnu");
  }

  if (profile === "tops") {
    penalize(/100\s*%\s*polyester/, 30, "100% polyester u topu");
    penalize(/akryl|acrylic/, 18, "akryl u topu");
    if (!/100\s*%\s*polyester/.test(value)) {
      penalize(/polyester/, 10, "obsahuje polyester");
    }
  } else if (profile === "knitwear") {
    penalize(/100\s*%\s*akryl|100\s*%\s*acrylic/, 32, "100% akryl u úpletu");
    if (!/100\s*%\s*(akryl|acrylic)/.test(value)) {
      penalize(/akryl|acrylic/, 20, "obsahuje akryl");
    }
    penalize(/100\s*%\s*polyester/, 22, "100% polyester u úpletu");
  } else if (profile === "denim") {
    penalize(/polyester/, 5, "polyester v denimu");
    reward(/elastan|elastane|spandex/, 4, "stretch příměs");
  } else if (profile === "outerwear") {
    reward(/peří|down|duck down|goose down/, 18, "péřová výplň");
    reward(/polyamid|polyamide|nylon/, 3, "funkční syntetika");
    penalize(/akryl|acrylic/, 8, "obsahuje akryl");
  } else if (profile === "sportswear") {
    reward(/polyamid|polyamide|nylon/, 7, "funkční syntetika");
    reward(/elastan|elastane|spandex/, 7, "pružnost");
    if (/polyester/.test(value)) signals.push("polyester je u sportu neutrální");
  } else {
    penalize(/100\s*%\s*polyester/, 12, "100% polyester");
    penalize(/akryl|acrylic/, 10, "obsahuje akryl");
  }

  return {
    score: clamp(score),
    signals,
    profile,
  };
}
