/** Local posts about flooding, rain, or weather. Other local chatter is left out. */
const STRONG_WEATHER = /\b(flood(?:ing|ed|s)?|flash\s*floods?|rain(?:ing|fall|s|y)?|weather|storms?|snow(?:ing|fall|y)?|thunders?torms?|lightning|hail|downpour|precip(?:itation)?|hurricanes?|tropical|ice\s*jams?|levees?|floodwalls?|evacuat(?:e|ion|ing)|inundat(?:e|ion|ed)|washouts?|high water|water levels?|roads?\s+closed|hydro(?:logic|logy)?)\b/i;
const WATERBODY = /\b(rivers?|creeks?|streams?|dams?)\b/i;
const WATER_CONDITION = /\b(high|higher|rising|risen|rise|up|flood\w*|level|crest|overflow\w*|overtop\w*|stage|discharge|cfs|feet|ft)\b/i;

function plainText(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, " ")
    .replace(/\s+/g, " ");
}

export function isWeatherReport(text: string): boolean {
  const plain = plainText(text);
  if (STRONG_WEATHER.test(plain)) return true;
  return WATERBODY.test(plain) && WATER_CONDITION.test(plain);
}
