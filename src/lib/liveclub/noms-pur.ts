// L'historique des noms Telegram (chantier « noms et paroles des membres »,
// passe 1, Brice 15/10/2026) : regles PURES, aucun reseau, aucun import de
// valeur. scripts/verifier-liveclub.mjs les verifie.
//
// La table cockpit_telegram_noms garde une ligne par (telegram_id, pseudo,
// nom_affiche) distincts, avec premier_vu, dernier_vu et la source de la
// premiere observation. Le journal l'alimente en best effort depuis :
// - le webhook du bot du groupe (chat_member) : source 'evenement' ;
// - les messages prives au bot des membres (champ from) : source 'prive',
//   UNE ecriture par compte et par jour au plus (nomANoter, ci-dessous, puis
//   la fonction SQL avec p_une_fois_par_jour).
// Le pipeline Python (collecter_telegram.py) l'alimente pour 'groupe' et
// 'message', avec la meme normalisation (textePropre) : un meme nom doit
// donner la meme ligne quel que soit son ecrivain.

export type SourceNom = 'groupe' | 'message' | 'evenement' | 'prive'

/** La forme minimale d'un utilisateur Telegram (Bot API) lue ici. */
export type UtilisateurTg = {
  id?: unknown
  is_bot?: boolean
  first_name?: unknown
  last_name?: unknown
  username?: unknown
}

export type IdentiteTg = { telegramId: number; pseudo: string | null; nomAffiche: string | null }

/** Une entree du tableau passe a public.cockpit_telegram_noms_noter(). */
export type LigneNom = {
  telegram_id: number
  pseudo: string | null
  nom_affiche: string | null
  vu_le: string
  source: SourceNom
}

export const MAX_PSEUDO = 64
export const MAX_NOM = 300

/** Espaces resserres, bords retires, vide = null, coupe a `max`. */
export function textePropre(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null
  const t = x.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/**
 * L'identite d'un compte Telegram, telle qu'on l'ecrit dans l'historique.
 * null = rien a noter : pas d'utilisateur, un bot, un identifiant illisible.
 * nom_affiche = first_name + last_name (comme cockpit_telegram_membres),
 * pseudo sans arobase.
 */
export function identiteTelegram(u: UtilisateurTg | null | undefined): IdentiteTg | null {
  if (!u || u.is_bot) return null
  const id = Number(u.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const pseudo = textePropre(typeof u.username === 'string' ? u.username.replace(/^@+/, '') : null, MAX_PSEUDO)
  const parties = [u.first_name, u.last_name].filter((x): x is string => typeof x === 'string' && x.length > 0)
  return { telegramId: id, pseudo, nomAffiche: textePropre(parties.join(' '), MAX_NOM) }
}

export function ligneNom(i: IdentiteTg, source: SourceNom, vuLe: Date): LigneNom {
  return { telegram_id: i.telegramId, pseudo: i.pseudo, nom_affiche: i.nomAffiche, vu_le: vuLe.toISOString(), source }
}

/** Ce qui fait « le meme nom le meme jour » : jour de Paris, pseudo et nom. */
export function cleNomDuJour(i: IdentiteTg, jour: string): string {
  return JSON.stringify([jour, i.pseudo, i.nomAffiche])
}

/** Au-dela, la memoire est videe (une instance qui vit longtemps). */
export const MAX_MEMOIRE_NOMS = 5000

/**
 * Faut-il ecrire ce nom vu en prive ? Une ecriture par compte et par jour au
 * plus : vrai la premiere fois du jour, faux ensuite, tant que le nom ne
 * change pas. Un nom qui change dans la journee s'ecrit (c'est l'information
 * cherchee). La memoire (compte -> derniere cle) est tenue par l'appelant,
 * par instance du serveur : la fonction SQL refait la meme garde en base,
 * pour les instances qui ne se connaissent pas.
 */
export function nomANoter(memoire: Map<number, string>, i: IdentiteTg, jour: string): boolean {
  const cle = cleNomDuJour(i, jour)
  if (memoire.get(i.telegramId) === cle) return false
  if (memoire.size >= MAX_MEMOIRE_NOMS && !memoire.has(i.telegramId)) memoire.clear()
  memoire.set(i.telegramId, cle)
  return true
}

// ---------------------------------------------------------------------------
// (17/11) Le REGISTRE du groupe (cockpit_telegram_membres) suit les pseudos.
// Cas reel : un compte venu du rattrapage du 10/09, pseudo NULL, qui a pris
// un pseudo ensuite ; l'agent du cockpit le cherchait par @pseudo et
// concluait « jamais vu ». Deux filets, sans nouveau mecanisme :
// - le webhook (noms.ts, rafraichirRegistre) : a chaque message (groupe ou
//   prive), bouton ou demande d'un compte deja au registre, le pseudo ou le
//   nom qui differe est corrige ;
// - le passage quotidien (tache w, passage.ts) : quelques getChatMember
//   bornes sur les comptes presents au pseudo NULL ou pas relus depuis
//   longtemps. maj_le sert d'horloge de relecture (remise a now() meme sans
//   changement, pour que la rotation avance).
// Un pseudo ou un nom ABSENT cote Telegram n'efface rien (comme l'upsert du
// webhook, coalesce) : l'historique des noms garde la trace du changement.
// ---------------------------------------------------------------------------

/** Ce que le registre sait d'un compte. */
export type IdentiteRegistre = { pseudo: string | null; nomAffiche: string | null }

/** Relectures getChatMember par passage, au plus (pas de rafale chez Telegram). */
export const PLAFOND_RELECTURES_PSEUDO = 25
/** Un compte present SANS pseudo est relu au plus une fois par ... jours. */
export const JOURS_RELECTURE_SANS_PSEUDO = 7
/** Un compte present AVEC pseudo est relu au plus une fois par ... jours. */
export const JOURS_RELECTURE_PSEUDO = 30

/**
 * Les champs du registre a corriger d'apres ce que Telegram rend. null = rien
 * a ecrire. Un pseudo ou un nom absent cote Telegram ne remplace jamais celui
 * du registre. La comparaison se fait sur la forme propre (textePropre) : un
 * espace en trop dans la base n'est pas un changement, une casse differente
 * en est un (c'est ainsi que Telegram l'affiche).
 */
export function champsARafraichir(base: IdentiteRegistre, vu: IdentiteTg): Partial<IdentiteRegistre> | null {
  const champs: Partial<IdentiteRegistre> = {}
  const pseudoBase = textePropre(typeof base.pseudo === 'string' ? base.pseudo.replace(/^@+/, '') : null, MAX_PSEUDO)
  const nomBase = textePropre(base.nomAffiche, MAX_NOM)
  if (vu.pseudo && vu.pseudo !== pseudoBase) champs.pseudo = vu.pseudo
  if (vu.nomAffiche && vu.nomAffiche !== nomBase) champs.nomAffiche = vu.nomAffiche
  return Object.keys(champs).length > 0 ? champs : null
}

/** La cle d'une identite vue (pseudo et nom), sans le jour. */
export function cleIdentite(i: IdentiteTg): string {
  return JSON.stringify([i.pseudo, i.nomAffiche])
}

/**
 * Faut-il confronter cette identite au registre ? Vrai la premiere fois qu'on
 * voit ce compte avec ce pseudo et ce nom sur cette instance du serveur, faux
 * ensuite : un membre qui ecrit cent messages ne fait qu'une requete. La
 * memoire est tenue par l'appelant ; on la marque APRES une requete reussie
 * (memoriserIdentite), pour qu'une panne de base laisse retenter au message
 * suivant.
 */
export function identiteARelire(memoire: Map<number, string>, i: IdentiteTg): boolean {
  return memoire.get(i.telegramId) !== cleIdentite(i)
}

/** Marque l'identite comme confrontee. Memoire bornee comme celle de nomANoter. */
export function memoriserIdentite(memoire: Map<number, string>, i: IdentiteTg): void {
  if (memoire.size >= MAX_MEMOIRE_NOMS && !memoire.has(i.telegramId)) memoire.clear()
  memoire.set(i.telegramId, cleIdentite(i))
}
