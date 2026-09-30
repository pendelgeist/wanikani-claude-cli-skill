import { stripMnemonicMarkup } from "./grading.js";
import { clickableUrl } from "./format.js";

/**
 * One place to turn a raw API subject into the shape the commands pass
 * around. `queue`, `drill` and `explain` all need the same identity fields
 * and the same answer key, and each used to unpack them itself — three copies
 * of `characters == null ? pickCharacterImage(…) : null`, three chances for
 * one of them to drift.
 */

// Some radicals have no Unicode glyph and rely on a custom image instead
// (WaniKani's `character_images` on the subject). Pick a PNG over an SVG —
// easier for a chat client to render inline — preferring one without a
// color override so it renders sanely on either light or dark background.
export function pickCharacterImage(characterImages) {
  if (!characterImages || characterImages.length === 0) return null;
  const pngs = characterImages.filter((img) => img.content_type === "image/png");
  const plain = pngs.find((img) => !img.metadata?.color);
  return (plain ?? pngs[0] ?? characterImages[0]).url;
}

// The API's image URLs are not always live: one radical's came back as an S3
// `AccessDenied` page, and the prompt sent the user to a link that showed
// nothing. A dead URL is a definite 403/404; a network failure proves nothing,
// so only a definite answer rules a candidate out.
const probed = new Map();
async function imageResolves(url) {
  if (!probed.has(url)) {
    probed.set(
      url,
      fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) })
        .then((res) => res.status !== 403 && res.status !== 404)
        .catch(() => true),
    );
  }
  return probed.get(url);
}

/**
 * The view with its radical image swapped for one that loads — PNGs first, then
 * whatever else the API lists. When none does, `characterImageUrl` is null and
 * `imageUnavailable` is set so the prompt can fall back to the radical's page
 * instead of pointing at a dead link. Glyph subjects pass through untouched.
 */
export async function withWorkingImage(view, subject) {
  if (!view.characterImageUrl) return view;
  const images = subject.data.character_images ?? [];
  const ranked = [...images.filter((i) => i.content_type === "image/png"), ...images.filter((i) => i.content_type !== "image/png")];
  for (const { url } of ranked) {
    if (url && (await imageResolves(url))) return { ...view, characterImageUrl: url };
  }
  return { ...view, characterImageUrl: null, imageUnavailable: true };
}

/** Identity plus answer key: what every command needs, named the same way. */
export function subjectView(subject) {
  const data = subject.data;
  return {
    subjectId: subject.id,
    subjectType: subject.object,
    level: data.level,
    characters: data.characters,
    characterImageUrl: data.characters == null ? pickCharacterImage(data.character_images) : null,
    // Kanji and vocabulary slugs are the glyph itself, which stops a
    // terminal's link detection dead — encoded here, once, so every command
    // that prints this URL prints a ctrl-clickable one.
    documentUrl: clickableUrl(data.document_url),
    meanings: data.meanings ?? [],
    auxiliaryMeanings: data.auxiliary_meanings ?? [],
    readings: data.readings ?? [],
  };
}

/** The teaching half — mnemonics and hints, WaniKani's markup already gone. */
export function teachingView(subject) {
  const data = subject.data;
  return {
    meaningMnemonic: stripMnemonicMarkup(data.meaning_mnemonic),
    meaningHint: stripMnemonicMarkup(data.meaning_hint),
    readingMnemonic: stripMnemonicMarkup(data.reading_mnemonic),
    readingHint: stripMnemonicMarkup(data.reading_hint),
  };
}
