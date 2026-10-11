// N-ATLaS as a money coach: short, practical answers and weekly tips in the rider's own language.
import { chat, ModelError } from './models.ts';
import { LANG_NAMES, type Lang } from './i18n.ts';

const COACH_SYSTEM = (lang: Lang) => `You are RidePass, a friendly money coach for Nigerian commercial riders (keke, okada, bus).
Answer in ${LANG_NAMES[lang]}${lang === 'pcm' ? ' (Nigerian Pidgin)' : ''}, in at most 3 short sentences, simple words.
Give practical advice on saving, budgeting, fuel costs, vehicle maintenance, repaying owners or lenders, and avoiding scams.
Never recommend a specific bank, app, investment or loan product. Never promise returns. If unsure, say so.
If the question is not about money or work, politely say you can only help with money matters.`;

export async function answerQuestion(lang: Lang, question: string): Promise<{ text: string; ms: number } | null> {
  try {
    const r = await chat([{ role: 'system', content: COACH_SYSTEM(lang) }, { role: 'user', content: question }], { maxTokens: 180, temperature: 0.3 });
    const text = r.text.trim();
    return text ? { text, ms: r.ms } : null;
  } catch (e) {
    if (e instanceof ModelError) return null;
    throw e;
  }
}

export async function weeklyTip(lang: Lang, stats: { income: number; spent: number; fuel: number; repaid: number; days: number }): Promise<string | null> {
  const q = `This week I logged ${stats.days} days: income ₦${stats.income}, total spending ₦${stats.spent} (fuel ₦${stats.fuel}), paid owner/loan ₦${stats.repaid}. Give me one practical tip for next week.`;
  const r = await answerQuestion(lang, q);
  return r?.text ?? null;
}
