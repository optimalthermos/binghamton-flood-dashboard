/** Local posts about flooding, rain, or weather. Other local chatter is left out. */
export const WEATHER_REPORT = /\b(flood(?:ing|ed|s)?|flash\s*floods?|rain(?:ing|fall|s|y)?|weather|storms?|snow(?:ing|fall|y)?|thunders?torms?|lightning|hail|downpour|precip(?:itation)?|hurricanes?|tropical|ice\s*jams?|levees?|floodwalls?|rivers?|creeks?|streams?|dams?|evacuat(?:e|ion|ing)|inundat(?:e|ion|ed)|washouts?|high water|water levels?|roads?\s+closed|hydro(?:logic|logy)?)\b/i;

export function isWeatherReport(text: string): boolean {
  return WEATHER_REPORT.test(text);
}
