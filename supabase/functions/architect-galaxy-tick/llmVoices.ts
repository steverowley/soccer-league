// ── architect-galaxy-tick/llmVoices.ts ───────────────────────────────────────
// The model-written versions of the Galaxy Dispatch voices — the opt-in path.
//
// STATUS: NOT THE DEFAULT.  The world runs on the local corpus in `voices.ts`.
// These generators only run when a deployment sets ISL_NARRATIVE_MODE=llm AND
// an ANTHROPIC_API_KEY is present; `preferLlm` routes to them and falls back to
// the corpus on any failure, so switching them on can add richness but can
// never make a voice go silent.
//
// They are kept intact — prompts, rules and all — so re-enabling a model is a
// config change rather than an archaeology exercise. If you edit the corpus's
// register, edit these prompts to match, or the two paths will drift into
// sounding like different worlds.

// deno-lint-ignore-file no-explicit-any
// ^ `any` is the Anthropic SDK client, which ships no Deno-native types here.

import type { EntityRow, FocusEnactedRow, NarrativeDraft, NarrativeRow, PoliticianRow, SocialMediaRow } from './types.ts';

/** Claude model for out-of-match narration. Dated id — see #514. */
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

/** Max output tokens per entity call. Narratives are 2–4 sentences each. */
const MAX_OUTPUT_TOKENS = 512;

export async function llmEntityNarrative(
  anthropic: any,
  entity: EntityRow,
  targetKind: string,
  matches: Array<{ home: string; away: string; result: string; played_at: string }>,
  focuses: FocusEnactedRow[],
  priorNarr: NarrativeRow[],
): Promise<NarrativeDraft | null> {
  const system = `You are ${entity.display_name ?? entity.name}, an in-world ISL personality writing for the Galaxy Dispatch.

RULES (absolute):
1. NEVER reveal underlying stats, numbers, probabilities, or mechanics. Treat the league like real life.
2. 2–4 sentences only. Evocative and in-character.
3. Output ONLY a single JSON object — no prose, no fences.

OUTPUT SCHEMA:
{"kind":"${targetKind}","summary":"your text here","entities_involved":["team-id-or-entity-name"]}`;

  const user = `Recent ISL results (redacted):
${matches.map((m) => `• ${m.result} (${m.played_at.slice(0, 10)})`).join('\n')}

Recent club decisions:
${focuses.length > 0
  ? focuses.map((f) => `• ${f.team_id} — ${f.focus_label} (${f.tier})`).join('\n')
  : '• (none yet this season)'}

Recent narratives (do NOT repeat these themes):
${priorNarr.map((n) => `• [${n.kind}] ${n.summary.slice(0, 150)}`).join('\n')}

Write ONE ${targetKind} as ${entity.display_name ?? entity.name}. JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const firstText = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    const cleaned   = firstText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed    = JSON.parse(cleaned) as Record<string, unknown>;

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) return null;

    const extraEntities = Array.isArray(parsed.entities_involved)
      ? (parsed.entities_involved.filter((e: unknown) => typeof e === 'string') as string[])
      : [];

    return { kind: targetKind, summary, extra_entities: extraEntities };
  } catch (err) {
    console.warn(`[generateEntityNarrative] failed for ${entity.name}:`, err);
    return null;
  }
}

export async function llmArchitectWhisper(
  anthropic: any,
  matches: Array<{ home: string; away: string; result: string; played_at: string }>,
  priorNarr: NarrativeRow[],
): Promise<string | null> {
  const system = `You are the Cosmic Architect of the Intergalactic Soccer League — a Lovecraftian, omniscient narrator who speaks in cryptic, unsettling fragments between matches.

RULES:
1. NEVER reveal stats, numbers, or game mechanics.
2. 1–3 sentences. Cryptic. A little wrong. References actual teams if possible.
3. Output ONLY the narrative text. No JSON, no labels.`;

  const user = `Recent results: ${matches.slice(0, 4).map((m) => m.result).join('; ')}

Recent narratives (avoid repeating): ${priorNarr.filter((n) => n.kind === 'architect_whisper').slice(0, 4).map((n) => n.summary.slice(0, 100)).join(' | ')}

Write one Architect whisper. Plain text only.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    return text.trim() || null;
  } catch (err) {
    console.warn('[generateArchitectWhisper] failed:', err);
    return null;
  }
}

export async function llmFocusReaction(
  // deno-lint-ignore no-explicit-any
  anthropic: any,
  row: { team_id: string; focus_key: string; focus_label: string; tier: string },
  teamName: string,
): Promise<string | null> {
  const system = `You are the Cosmic Architect of the Intergalactic Soccer League — a Lovecraftian, omniscient narrator who reacts to fan decisions in cryptic, unsettling fragments.

RULES:
1. NEVER reveal stats, numbers, percentages, or game mechanics.
2. 1–2 sentences. Cryptic. Knowing. Sometimes ominous, sometimes amused.
3. Reference the team name and the focus label by name so the fan recognises the trigger.
4. NEVER explain the mechanical effect of the choice — only the cosmos's reaction to the choice itself.
5. Output ONLY the narrative text. No JSON, no labels.

EXAMPLE TONE:
"They begged for a star. The cosmos delivered. They have not asked what the star was made of."
"${`Pluto FC Wanderers`} chose youth. The cosmos files this under 'choices that age poorly'."
"A new stadium for ${`Mars Athletic`}. The cosmos already knows which match will be played in its rubble."`;

  const user = `A fanbase has just voted to enact a ${row.tier} focus for their club.

TEAM: ${teamName}
FOCUS: ${row.focus_label} (key: ${row.focus_key})

Write one Architect whisper reacting to this choice. Plain text only.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 220,
      system,
      messages: [{ role: 'user', content: user }],
    });
    // deno-lint-ignore no-explicit-any
    const text = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    return text.trim() || null;
  } catch (err) {
    console.warn('[generateFocusReaction] failed:', err);
    return null;
  }
}

export async function llmPoliticalDecree(
  // deno-lint-ignore no-explicit-any
  anthropic: any,
  politician: PoliticianRow,
  matches: Array<{ home: string; away: string; result: string; played_at: string }>,
  priorNarr: NarrativeRow[],
): Promise<string | null> {
  const displayName = politician.display_name ?? politician.name;
  const { role, party, homeworld, description } = politician.meta;

  const system = `You are ${displayName}, ${role} of the ${party}, representing ${homeworld} in the Intergalactic Soccer League universe.

${description}

RULES (absolute):
1. NEVER reveal underlying stats, numbers, probabilities, or game mechanics.
2. 1–3 sentences only. Official, slightly pompous, in-character.
3. You may reference teams or recent results but only in qualitative terms (never scores).
4. Output ONLY the decree text. No JSON, no labels, no headers.

TONE: Political officials in the ISL universe treat soccer as a proxy for interplanetary prestige. Your statement should feel like a press release filtered through genuine in-world ideology — concern for your homeworld's clubs, commentary on cosmic governance, self-serving but plausible.`;

  const user = `Recent ISL results (redacted, no raw scores):
${matches.slice(0, 5).map((m) => `• ${m.result} (${m.played_at.slice(0, 10)})`).join('\n')}

Recent narratives (do NOT repeat these themes):
${priorNarr.filter((n) => n.kind === 'political_decree').slice(0, 4).map((n) => `• ${n.summary.slice(0, 150)}`).join('\n') || '• (none yet)'}

Issue one brief political decree as ${displayName}. Plain text only.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 250,
      system,
      messages: [{ role: 'user', content: user }],
    });
    // deno-lint-ignore no-explicit-any
    const text = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    return text.trim() || null;
  } catch (err) {
    console.warn('[generatePoliticalDecree] failed:', err);
    return null;
  }
}

export async function llmMediaBuzz(
  // deno-lint-ignore no-explicit-any
  anthropic: any,
  platform: SocialMediaRow,
  matches: Array<{ home: string; away: string; result: string; played_at: string }>,
  priorNarr: NarrativeRow[],
): Promise<string | null> {
  const displayName = platform.display_name ?? platform.name;
  const { format, reach, description } = platform.meta;

  // Each format gets a distinct writing register so platforms sound
  // distinguishable in the feed without requiring per-platform templates.
  const formatGuide =
    format === 'microblog'
      ? 'hot takes, punchy, 1–2 sentences, possibly inflammatory — the kind of post that goes viral for the wrong reasons'
      : format === 'forum'
      ? 'long-thread energy condensed into 2–3 sentences — analytical, opinionated, name-drops teams and players freely'
      : 'video-hook style — exclamation-heavy, YouTube-thumbnail energy, promises something dramatic';

  const system = `You are summarising trending content on ${displayName}, a ${format} platform in the Intergalactic Soccer League universe.

${description}
Platform reach: ${reach}.

RULES (absolute):
1. NEVER reveal underlying stats, numbers, probabilities, or game mechanics.
2. Write as a narrator describing what is trending ON the platform — not as a single user, but as the voice of the crowd.
3. ${formatGuide}
4. Output ONLY the buzz summary. No JSON, no labels.`;

  const user = `Recent ISL results (redacted, no raw scores):
${matches.slice(0, 5).map((m) => `• ${m.result} (${m.played_at.slice(0, 10)})`).join('\n')}

Recent narratives (do NOT repeat these themes):
${priorNarr.filter((n) => n.kind === 'media_buzz').slice(0, 4).map((n) => `• ${n.summary.slice(0, 150)}`).join('\n') || '• (none yet)'}

Write one trending ${format} buzz summary from ${displayName}. Plain text only.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 250,
      system,
      messages: [{ role: 'user', content: user }],
    });
    // deno-lint-ignore no-explicit-any
    const text = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    return text.trim() || null;
  } catch (err) {
    console.warn('[generateMediaBuzz] failed:', err);
    return null;
  }
}
