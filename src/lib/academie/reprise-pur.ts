// La REPRISE de la progression des membres de Skool (15/11/2026, carte 382) :
// la regle du bouton « Deja vu avant », la correspondance des cours de Skool
// avec les modules de l'academie, le repere « Sur Skool : 64 % », la lecture
// du releve de Yume, et les requetes SQL (jouees telles quelles par
// scripts/essayer-migration-reprise.mjs, transaction annulee).
//
// Briefs : D:\7_Agents\briefs\2026-11-15-academie-reprise-progression-skool.md
// et ...-codeur.md (mise a jour du 15/11 apres-midi : le releve). Migration :
// sites/Aoknowledgecom/supabase/migrations/20261115180000_academie_reprise_progression.sql.
//
// PUR : aucun import a l'execution sauf node:crypto (les types de pur.ts
// s'effacent) : scripts/verifier-reprise.mjs l'importe avec Node seul.
// Jamais un email ni un nom dans ce qui sort d'ici vers un log : des comptes,
// et au besoin empreinte() (8 caracteres d'un sha256).

import { createHash } from 'node:crypto'
import type { Ouvert, Raison } from './pur'

// ---------------------------------------------------------------------------
// Les reglages (la regle par defaut de Yume, a faire valider par Brice)
// ---------------------------------------------------------------------------

/** Le bouton sert pendant ce nombre de jours apres l'arrivee du membre dans l'academie. */
export const REPRISE_JOURS = 30

/**
 * La fenetre ne commence jamais avant cette date : l'arrivee des membres de
 * Skool dans l'academie (lundi 16/11/2026, minuit a Paris). Un membre arrive
 * avant (l'alpha d'octobre, ceux qui ont deja coche a la main) a ses
 * REPRISE_JOURS jours a partir d'elle. null = l'arrivee seule fait foi.
 */
export const REPRISE_DEPUIS: string | null = '2026-11-16T00:00:00+01:00'

/**
 * « Une fois par cours » (Yume) : 'cours' = une seule reprise par module, que
 * ce soit le module entier OU une de ses sections (la regle la plus simple a
 * dire). 'cible' = une fois par section et une fois pour le module (une
 * section apres le module entier est refusee : tout est deja coche). La base
 * tient la regle (index unique sur la cle verrouReprise) : la changer ici ne
 * demande aucune migration.
 */
export type RegleUneFois = 'cours' | 'cible'
export const REPRISE_UNE_FOIS_PAR: RegleUneFois = 'cours'

/**
 * Qui a un historique (mise a jour du brief, 15/11 apres-midi) :
 * - releve_skool : au moins une lecon terminee sur Skool dans le releve du
 *   15/11, pour un membre de Skool RATTACHE au compte (par une adresse
 *   verifiee non ambigue, ou a la main par l'equipe), jamais par le nom ;
 * - ancien : ancien membre IziTrade ou LearnyBox (aok_anciens_membres active
 *   sur ce compte, hors reservations de l'equipe).
 * Un membre de Skool sans aucune lecon terminee n'a pas le bouton.
 */
export type SourceHistorique = 'releve_skool' | 'ancien'
export const HISTORIQUES_REPRISE: readonly SourceHistorique[] = ['releve_skool', 'ancien']

/** Garde-fous de la route : reprises reussies par heure et par compte, et ecart entre deux appels (par instance). */
export const REPRISES_PAR_HEURE = 20
export const ECART_REPRISE_MS = 3000

/** Les sources d'adresse du releve. 'ambigu-plusieurs-homonymes' n'est jamais rattachee automatiquement. */
export const SOURCES_EMAIL = ['export-07-11', 'export-officiel-11-11-par-nom', 'aucune', 'ambigu-plusieurs-homonymes'] as const
export type SourceEmail = (typeof SOURCES_EMAIL)[number]
export const SOURCE_AMBIGUE: SourceEmail = 'ambigu-plusieurs-homonymes'

// ---------------------------------------------------------------------------
// L'historique et la fenetre
// ---------------------------------------------------------------------------

export type FaitsReprise = {
  releveSkool: boolean
  ancien: boolean
  /** La premiere trace du compte dans l'academie (academie_lectures), null = aucune. */
  arrivee: Date | null
  /** L'heure de la base. */
  maintenant: Date
}

export function aUnHistorique(f: Pick<FaitsReprise, 'releveSkool' | 'ancien'>, sources: readonly SourceHistorique[] = HISTORIQUES_REPRISE): boolean {
  return (sources.includes('releve_skool') && f.releveSkool) || (sources.includes('ancien') && f.ancien)
}

/**
 * La fenetre du bouton : de l'arrivee dans l'academie (premiere connexion
 * notee par /moi), jamais avant REPRISE_DEPUIS, pendant REPRISE_JOURS jours.
 * Sans arrivee notee : elle commence maintenant.
 */
export function fenetreReprise(
  arrivee: Date | null, maintenant: Date, o: { jours?: number; depuis?: string | null } = {},
): { debut: Date; fin: Date } {
  const jours = o.jours ?? REPRISE_JOURS
  const depuis = o.depuis === undefined ? REPRISE_DEPUIS : o.depuis
  let debut = (arrivee ?? maintenant).getTime()
  const plancher = depuis ? Date.parse(depuis) : NaN
  if (Number.isFinite(plancher)) debut = Math.max(debut, plancher)
  return { debut: new Date(debut), fin: new Date(debut + jours * 86_400_000) }
}

export type EtatReprise = {
  historique: boolean
  /** Le bouton peut servir maintenant (historique ET dans la fenetre). */
  ouverte: boolean
  /** La fin de la fenetre (null sans historique). */
  jusquau: Date | null
  refus: 'historique' | 'delai' | null
}

export function etatReprise(f: FaitsReprise, o: { jours?: number; depuis?: string | null; sources?: readonly SourceHistorique[] } = {}): EtatReprise {
  const historique = aUnHistorique(f, o.sources)
  if (!historique) return { historique, ouverte: false, jusquau: null, refus: 'historique' }
  const { fin } = fenetreReprise(f.arrivee, f.maintenant, o)
  const ouverte = f.maintenant.getTime() < fin.getTime()
  return { historique, ouverte, jusquau: fin, refus: ouverte ? null : 'delai' }
}

// ---------------------------------------------------------------------------
// Une fois par cours
// ---------------------------------------------------------------------------

/** La cle du « une fois » ecrite dans academie_reprises.verrou (mode membre). */
export function verrouReprise(regle: RegleUneFois, moduleId: string, sectionId: string | null): string {
  if (regle === 'cible' && sectionId) return `section:${sectionId}`
  return `module:${moduleId}`
}

export type RepriseFaite = { moduleId: string; sectionId: string | null; mode: 'membre' | 'equipe' }

/** Le compte a-t-il deja utilise son « Deja vu avant » pour cette cible ? Les gestes de l'equipe ne comptent pas. */
export function dejaFaite(regle: RegleUneFois, faites: readonly RepriseFaite[], moduleId: string, sectionId: string | null): boolean {
  const miennes = faites.filter(f => f.mode === 'membre' && f.moduleId === moduleId)
  if (regle === 'cours') return miennes.length > 0
  return miennes.some(f => f.sectionId === null || (sectionId !== null && f.sectionId === sectionId))
}

// ---------------------------------------------------------------------------
// Le plan d'une reprise (ce que la route coche)
// ---------------------------------------------------------------------------

/** Une lecon du module, deja jugee par la route (ouvertureLecon) et lue dans la progression. */
export type LeconPourReprise = {
  id: string
  sectionId: string | null
  /** Publiee dans un module publie. */
  lisible: boolean
  acces: Ouvert
  raisons: readonly Raison[]
  /** Deja a l'etat « vu » (quelle qu'en soit la voie). */
  vue: boolean
}

export type RefusReprise =
  | 'historique' // 403 : pas d'historique
  | 'delai' // 403 : la fenetre est passee
  | 'module' // 404 : module inconnu, pas publie, ou lien externe
  | 'section' // 404 : la section n'est pas de ce module
  | 'deja' // 409 : deja utilise pour ce cours
  | 'acces' // 403 : aucune lecon de la cible n'est a ce compte
  | 'vide' // 409 : tout est deja vu, rien a cocher (le « une fois » n'est pas consomme)
  | 'inconnu' // 503 : un droit illisible (Live Club) sur une lecon de la cible

export type PlanReprise =
  | { refus: RefusReprise }
  | { lecons: string[]; dejaVues: number; verrou: string; portee: 'module' | 'section' }

/** Ouvert par autre chose qu'un apercu ou le billet du jour : la lecon est vraiment au membre. */
export function ouvertePourDeVrai(l: Pick<LeconPourReprise, 'acces' | 'raisons'>): boolean {
  return l.acces === 'ouvert' && l.raisons.some(r => r !== 'apercu' && r !== 'billet')
}

/**
 * La decision du serveur, dans l'ordre : historique, fenetre, module,
 * section, une fois, droits. Ne coche que les lecons PUBLIEES de la cible que
 * le compte a pour de vrai et qui ne sont pas deja vues : les lecons vues
 * autrement (mesure, fin, texte lu, clic) ne sont jamais touchees.
 */
export function planReprise(p: {
  etat: EtatReprise
  regle?: RegleUneFois
  faites: readonly RepriseFaite[]
  module: { id: string; publie: boolean; externe: boolean } | null
  sectionId: string | null
  /** Les sections du module (ids). */
  sections: readonly string[]
  /** Toutes les lecons du module. */
  lecons: readonly LeconPourReprise[]
}): PlanReprise {
  const regle = p.regle ?? REPRISE_UNE_FOIS_PAR
  if (!p.etat.historique) return { refus: 'historique' }
  if (!p.etat.ouverte) return { refus: 'delai' }
  if (!p.module || !p.module.publie || p.module.externe) return { refus: 'module' }
  if (p.sectionId !== null && !p.sections.includes(p.sectionId)) return { refus: 'section' }
  if (dejaFaite(regle, p.faites, p.module.id, p.sectionId)) return { refus: 'deja' }

  const cible = p.lecons.filter(l => l.lisible && (p.sectionId === null || l.sectionId === p.sectionId))
  if (cible.some(l => l.acces === 'inconnu')) return { refus: 'inconnu' }
  const aMoi = cible.filter(ouvertePourDeVrai)
  if (aMoi.length === 0) return { refus: 'acces' }
  const aCocher = aMoi.filter(l => !l.vue).map(l => l.id)
  if (aCocher.length === 0) return { refus: 'vide' }
  return {
    lecons: aCocher,
    dejaVues: aMoi.length - aCocher.length,
    verrou: verrouReprise(regle, p.module.id, p.sectionId),
    portee: p.sectionId === null ? 'module' : 'section',
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function uuid(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  return UUID_RE.test(t) ? t : null
}

/** POST /api/academie/reprise : { module, section? } (ids). null = corps illisible. */
export function lireDemandeReprise(corps: unknown): { module: string; section: string | null } | null {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  const idModule = uuid(c.module)
  if (!idModule) return null
  if (c.section === undefined || c.section === null) return { module: idModule, section: null }
  const section = uuid(c.section)
  return section ? { module: idModule, section } : null
}

// ---------------------------------------------------------------------------
// Les cours de Skool et les modules de l'academie
// ---------------------------------------------------------------------------

/**
 * La correspondance, VERSIONNEE ici plutot qu'en table (choix explique dans
 * le rapport) : 17 cours a contenu, relus a la main, un fichier que la revue
 * de code montre ligne a ligne, et que le releve (une seule fois, Skool
 * ferme le 18/11) ne fera plus bouger. Les ids sont ceux du releve du 15/11
 * (32 caracteres, cours-skool-2026-11-15.csv). Le titre sert de secours.
 *
 * module : le slug du module de l'academie ; niveauModule : ce cours compte
 * dans le repere du module entier ; section : debut du titre de la section
 * (sans casse ni accents) quand le cours correspond a une partie. Plusieurs
 * cours vers un meme module (Partie 1 et Partie 2 -> La Formation complete) :
 * le repere du module est le total des lecons terminees sur le total des
 * lecons. sure = false : douteux, le repere n'est PAS montre (liste dans le
 * rapport, a trancher par Brice). module null : aucun equivalent.
 */
export type CorrespondanceSkool = {
  skool: string
  titre: string
  module: string | null
  niveauModule: boolean
  section: string | null
  sure: boolean
  note: string
}

export const CORRESPONDANCE_SKOOL: readonly CorrespondanceSkool[] = [
  { skool: '24f3805eb884446b95190f1289fdf382', titre: 'Initiation Skool', module: null, niveauModule: false, section: null, sure: true,
    note: "Le mode d'emploi de Skool : aucun equivalent dans l'academie." },
  { skool: '95bcf798db3f45f6aeadf8a2a66844bd', titre: 'Articles - Ao Knowledge', module: null, niveauModule: false, section: null, sure: true,
    note: "Les articles sont sur le blog (RELEVE-CLASSROOM) ; le module nos-articles-prives n'a qu'une lecon." },
  { skool: '2fa73af4e8dc4bc089b95fb55510f7bc', titre: 'Liveclub', module: 'liveclub', niveauModule: true, section: null, sure: true,
    note: '4 lecons sur Skool, 3 dans l academie (la 4e parlait d Edgyx).' },
  { skool: 'a8ce77d4d50147bd9e97badd28baebec', titre: 'Novice en trading', module: 'novice-en-trading', niveauModule: true, section: null, sure: true,
    note: '7 lecons des deux cotes.' },
  { skool: '7598376dbf674f4292ab754ccfbb65ca', titre: 'Les bases Smart Money', module: 'les-bases-smart-money', niveauModule: true, section: null, sure: true,
    note: '17 lecons des deux cotes.' },
  { skool: '37e96d438ae74ba89cfed1802431abbb', titre: 'La formation - Partie 1', module: 'la-formation-complete', niveauModule: true, section: 'partie 1', sure: true,
    note: '42 lecons des deux cotes, section Partie 1 : episodes 0 a 19.' },
  { skool: 'db9ea221835b43bc96e52e162cfa3559', titre: 'La formation - Partie 2', module: 'la-formation-complete', niveauModule: true, section: 'partie 2', sure: true,
    note: '42 lecons des deux cotes, section Partie 2 : episodes 20 a 39.' },
  { skool: 'd4dd6c7a134b437ab6774c6c7e4f3762', titre: 'Fondations & Plan de Trading', module: 'plan-de-trading-21-jours', niveauModule: true, section: null, sure: true,
    note: '60 lecons en 21 journees sur Skool, 69 lecons en 23 sections dans l academie : meme cours, renomme.' },
  { skool: '65f8c7ec46b2440ea0188280d83016a5', titre: 'Psychologie & emotions', module: 'psychologie-et-emotions', niveauModule: true, section: null, sure: true,
    note: '20 lecons des deux cotes.' },
  { skool: '0ef8880bf45f40e59ba84f90b6729920', titre: "Chronique de l'accelerateur", module: 'chroniques-de-l-accelerateur', niveauModule: true, section: null, sure: false,
    note: '66 lecons sur Skool, 180 dans l academie (billets compris) : le pourcentage de Skool ne parlerait que d un tiers du module.' },
  { skool: 'd7be803d71994500b765073a16acbdaf', titre: 'Replay Premium', module: 'rediffusion-des-lives', niveauModule: false, section: 'replay premium', sure: true,
    note: '22 lecons des deux cotes, devenu une partie de Rediffusion des Lives (13/11).' },
  { skool: 'da8fce017cfa4f308106ab268e2193c1', titre: 'Rediffusion des Lives', module: 'rediffusion-des-lives', niveauModule: false, section: 'archives des lives', sure: false,
    note: '31 lecons sur Skool, 465 dans le module (283 dans Archives des lives) : partie exacte a confirmer.' },
  { skool: '953f81e433254698b228f04c174fca5f', titre: 'Serenite Financiere', module: 'serenite-financiere', niveauModule: true, section: null, sure: true,
    note: '45 lecons des deux cotes.' },
  { skool: 'd31ba04e2a434f608b36fd2fd5ca4fa2', titre: 'Journaling : la cle de ta progression', module: 'journaling', niveauModule: true, section: null, sure: true,
    note: '20 lecons des deux cotes.' },
  { skool: 'd4ea1c13d8a2499da43d8ac8d977c797', titre: 'Macros : Les Archives Privees', module: 'macros-les-archives-privees', niveauModule: true, section: null, sure: true,
    note: '20 lecons des deux cotes.' },
  { skool: 'f5c7c8271c304b8a807dfa444d653b05', titre: "L'Appat du Grand Public", module: 'l-appat-du-grand-public', niveauModule: true, section: null, sure: true,
    note: '29 lecons des deux cotes.' },
  { skool: '43dbbe75bad447d9b66aba6ae0d179a6', titre: 'Replay Masterclass', module: null, niveauModule: false, section: null, sure: true,
    note: 'Le module masterclass de l academie est un lien vers le site Masterclass : pas de bouton.' },
  { skool: 'cd7e41020cda43bd901602e125d7379b', titre: 'Acces aux Lives', module: null, niveauModule: false, section: null, sure: true,
    note: 'Une seule lecon (un live de 2025) : aucun equivalent.' },
]

/** Sans casse, sans accents, ponctuation en espaces simples. */
export function normaliserTitre(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const ID_SKOOL_RE = /^[0-9a-f]{32}$/

/** L'id d'un cours ou d'un membre de Skool (32 caracteres hexadecimaux), ou null. */
export function idSkool(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  return ID_SKOOL_RE.test(t) ? t : null
}

/** La correspondance d'un cours de Skool : par l'id, sinon par le titre. null = cours inconnu de la liste. */
export function correspondanceDe(id: string, titre: string, liste: readonly CorrespondanceSkool[] = CORRESPONDANCE_SKOOL): CorrespondanceSkool | null {
  const parId = liste.find(c => c.skool === id)
  if (parId) return parId
  const n = normaliserTitre(titre)
  return n ? liste.find(c => normaliserTitre(c.titre) === n) ?? null : null
}

export type LigneReleveCompte = {
  skoolCoursId: string
  skoolCoursTitre: string
  leconsTerminees: number
  leconsTotal: number
  releveLe: string
}

export type Repere = { pourcentage: number; terminees: number; total: number; releveLe: string; cours: number }

/**
 * Les reperes d'un compte, par cible : 'module:<id>' et 'section:<id>'.
 * - Le releve le plus recent de chaque cours de Skool ; deux membres de Skool
 *   rattaches au meme compte : le plus avance des deux pour ce cours.
 * - Seulement les correspondances sures, et les cours non vides.
 * - Plusieurs cours vers une cible : total des lecons terminees sur total des
 *   lecons (Partie 1 et Partie 2 pour La Formation complete).
 */
export function reperesSkool(
  lignes: readonly LigneReleveCompte[],
  catalogue: { modules: readonly { id: string; slug: string }[]; sections: readonly { id: string; moduleId: string; titre: string }[] },
  liste: readonly CorrespondanceSkool[] = CORRESPONDANCE_SKOOL,
): Map<string, Repere> {
  const parCours = new Map<string, LigneReleveCompte>()
  for (const l of lignes) {
    if (!(l.leconsTotal > 0)) continue
    const avant = parCours.get(l.skoolCoursId)
    if (!avant || l.releveLe > avant.releveLe || (l.releveLe === avant.releveLe && l.leconsTerminees > avant.leconsTerminees)) {
      parCours.set(l.skoolCoursId, l)
    }
  }
  const sommes = new Map<string, { terminees: number; total: number; releveLe: string; cours: number }>()
  const ajouter = (cle: string, l: LigneReleveCompte) => {
    const s = sommes.get(cle) ?? { terminees: 0, total: 0, releveLe: l.releveLe, cours: 0 }
    s.terminees += Math.min(l.leconsTerminees, l.leconsTotal)
    s.total += l.leconsTotal
    s.cours += 1
    if (l.releveLe > s.releveLe) s.releveLe = l.releveLe
    sommes.set(cle, s)
  }
  for (const l of parCours.values()) {
    const c = correspondanceDe(l.skoolCoursId, l.skoolCoursTitre, liste)
    if (!c || !c.sure || !c.module) continue
    const m = catalogue.modules.find(x => x.slug === c.module)
    if (!m) continue
    if (c.niveauModule) ajouter(`module:${m.id}`, l)
    if (c.section) {
      const prefixe = normaliserTitre(c.section)
      const s = catalogue.sections.find(x => x.moduleId === m.id && normaliserTitre(x.titre).startsWith(prefixe))
      if (s) ajouter(`section:${s.id}`, l)
    }
  }
  const sortie = new Map<string, Repere>()
  for (const [cle, s] of sommes) {
    if (s.total > 0) sortie.set(cle, { ...s, pourcentage: Math.round((s.terminees * 100) / s.total) })
  }
  return sortie
}

// ---------------------------------------------------------------------------
// Le releve de Yume (CSV, BOM, separateur ;)
// ---------------------------------------------------------------------------

/** Un CSV simple : guillemets doubles, separateur donne, BOM et fins de ligne Windows toleres. */
export function decouperCsv(texte: string, separateur = ';'): string[][] {
  const t = texte.replace(/^\uFEFF/, '')
  const lignes: string[][] = []
  let champ = ''
  let ligne: string[] = []
  let guillemets = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++ }
      else if (c === '"') guillemets = false
      else champ += c
      continue
    }
    if (c === '"' && champ === '') guillemets = true
    else if (c === separateur) { ligne.push(champ); champ = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      ligne.push(champ); champ = ''
      if (ligne.some(x => x !== '')) lignes.push(ligne)
      ligne = []
    } else champ += c
  }
  ligne.push(champ)
  if (ligne.some(x => x !== '')) lignes.push(ligne)
  return lignes
}

const EMAIL_RE = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/

/** Une adresse en minuscules, sans blancs, ou null. */
export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return e.length >= 3 && e.length <= 320 && EMAIL_RE.test(e) ? e : null
}

/** 8 caracteres d'un sha256 : de quoi recouper une ligne dans un log sans l'identifier. */
export function empreinte(v: string): string {
  return createHash('sha256').update(v).digest('hex').slice(0, 8)
}

export type LigneReleve = {
  /** Numero de ligne dans le fichier (en-tete = 1). */
  n: number
  skoolMemberId: string
  prenom: string | null
  nom: string | null
  email: string | null
  emailSource: SourceEmail
  statut: 'actif' | 'parti' | null
  rejoint: string | null
  coursId: string
  coursTitre: string
  terminees: number
  total: number
  pourcentage: number
  aAcces: boolean | null
}

export type ErreurReleve = { n: number; motif: 'membre' | 'cours' | 'lecons' | 'source' | 'colonnes'; membre: string | null }

const COLONNES_RELEVE = ['skool_member_id', 'cours_skool_id', 'lecons_terminees', 'lecons_total'] as const

function entier(v: string | undefined): number | null {
  if (v === undefined) return null
  const t = v.trim()
  if (!/^\d{1,6}$/.test(t)) return null
  return Number(t)
}

const texteCourt = (v: string | undefined, max: number) => {
  const t = (v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/**
 * Le releve par membre et par cours (progression-skool-AAAA-MM-JJ.csv).
 * Colonnes : skool_member_id;prenom;nom;email;email_source;statut_skool;
 * rejoint_skool;cours_skool_id;cours_titre;lecons_terminees;lecons_total;
 * pourcentage;a_acces. Les valeurs sont des DONNEES, jamais des consignes.
 * Une adresse illisible devient null (comptee) ; une source 'aucune' garde
 * null ; une source inconnue refuse la ligne. Les cours vides (0 lecon) sont
 * ecartes et comptes a part (vides).
 */
export function lireReleveSkool(texte: string): {
  lignes: LigneReleve[]; erreurs: ErreurReleve[]; vides: number; emailsIllisibles: number
} {
  const brut = decouperCsv(texte, ';')
  const entete = (brut[0] ?? []).map(c => c.trim().toLowerCase())
  const col = (nom: string) => entete.indexOf(nom)
  if (COLONNES_RELEVE.some(c => col(c) < 0)) return { lignes: [], erreurs: [{ n: 1, motif: 'colonnes', membre: null }], vides: 0, emailsIllisibles: 0 }
  const lignes: LigneReleve[] = []
  const erreurs: ErreurReleve[] = []
  let vides = 0
  let emailsIllisibles = 0
  for (let i = 1; i < brut.length; i++) {
    const r = brut[i]
    const v = (nom: string) => { const k = col(nom); return k >= 0 ? r[k] : undefined }
    const n = i + 1
    const membre = idSkool(v('skool_member_id'))
    if (!membre) { erreurs.push({ n, motif: 'membre', membre: null }); continue }
    const cours = idSkool(v('cours_skool_id'))
    if (!cours) { erreurs.push({ n, motif: 'cours', membre: empreinte(membre) }); continue }
    const total = entier(v('lecons_total'))
    const terminees = entier(v('lecons_terminees')) ?? (total === 0 ? 0 : null)
    if (total === null || terminees === null || terminees > total) { erreurs.push({ n, motif: 'lecons', membre: empreinte(membre) }); continue }
    if (total === 0) { vides++; continue }
    const sourceBrute = (v('email_source') ?? '').trim().toLowerCase() || 'aucune'
    const source = SOURCES_EMAIL.find(s => s === sourceBrute)
    if (!source) { erreurs.push({ n, motif: 'source', membre: empreinte(membre) }); continue }
    let email: string | null = null
    if (source !== 'aucune') {
      email = normaliserEmail(v('email'))
      if (!email && (v('email') ?? '').trim()) emailsIllisibles++
    }
    const statut = (v('statut_skool') ?? '').trim().toLowerCase()
    const rejoint = (v('rejoint_skool') ?? '').trim()
    const pc = entier(v('pourcentage'))
    const acces = (v('a_acces') ?? '').trim().toLowerCase()
    lignes.push({
      n,
      skoolMemberId: membre,
      prenom: texteCourt(v('prenom'), 120),
      nom: texteCourt(v('nom'), 120),
      email,
      emailSource: source,
      statut: statut === 'actif' || statut === 'parti' ? statut : null,
      rejoint: /^\d{4}-\d{2}-\d{2}$/.test(rejoint) ? rejoint : null,
      coursId: cours,
      coursTitre: texteCourt(v('cours_titre'), 300) ?? cours,
      terminees,
      total,
      pourcentage: pc !== null && pc <= 100 ? pc : Math.round((terminees * 100) / total),
      aAcces: acces === '1' || acces === 'true' ? true : acces === '0' || acces === 'false' ? false : null,
    })
  }
  return { lignes, erreurs, vides, emailsIllisibles }
}

/** Les cours (cours-skool-AAAA-MM-JJ.csv) : id -> { titre, lecons, vide } (etat_skool = 1 ou 0 lecon = vide). */
export function lireCoursSkool(texte: string): Map<string, { titre: string; lecons: number; vide: boolean }> {
  const brut = decouperCsv(texte, ';')
  const entete = (brut[0] ?? []).map(c => c.trim().toLowerCase())
  const k = (nom: string) => entete.indexOf(nom)
  const sortie = new Map<string, { titre: string; lecons: number; vide: boolean }>()
  for (const r of brut.slice(1)) {
    const id = idSkool(r[k('cours_skool_id')])
    if (!id) continue
    const lecons = entier(r[k('lecons_total')]) ?? 0
    const etat = (r[k('etat_skool')] ?? '').trim()
    sortie.set(id, { titre: texteCourt(r[k('titre')], 300) ?? id, lecons, vide: etat === '1' || lecons === 0 })
  }
  return sortie
}

export type MembreReleve = {
  skoolMemberId: string
  prenom: string | null
  nom: string | null
  email: string | null
  emailSource: SourceEmail
  statut: 'actif' | 'parti' | null
  rejoint: string | null
  /** Au moins une lecon terminee dans un cours non vide : l'historique de la regle. */
  historique: boolean
  /** Les lignes du membre ne disent pas toutes la meme chose (adresse, nom) : la premiere est gardee. */
  incoherent: boolean
}

/** Les membres du releve (une entree par skool_member_id), sans les cours vides de Skool. */
export function membresDuReleve(lignes: readonly LigneReleve[], coursVides: ReadonlySet<string> = new Set()): Map<string, MembreReleve> {
  const sortie = new Map<string, MembreReleve>()
  for (const l of lignes) {
    const deja = sortie.get(l.skoolMemberId)
    const compte = !coursVides.has(l.coursId) && l.terminees > 0
    if (!deja) {
      sortie.set(l.skoolMemberId, {
        skoolMemberId: l.skoolMemberId, prenom: l.prenom, nom: l.nom, email: l.email, emailSource: l.emailSource,
        statut: l.statut, rejoint: l.rejoint, historique: compte, incoherent: false,
      })
      continue
    }
    if (compte) deja.historique = true
    if (deja.email !== l.email || deja.emailSource !== l.emailSource || deja.nom !== l.nom || deja.prenom !== l.prenom) deja.incoherent = true
  }
  return sortie
}

/** Une adresse qui peut rattacher automatiquement : presente et pas d'une source ambigue. */
export function rattachableParEmail(m: Pick<MembreReleve, 'email' | 'emailSource'>): boolean {
  return m.email !== null && m.emailSource !== SOURCE_AMBIGUE && m.emailSource !== 'aucune'
}

/** La date du releve lue dans le nom du fichier (progression-skool-2026-11-15.csv), ou null. */
export function dateDuFichier(nom: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(nom)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// Les requetes (role postgres du serveur du journal, ou scripts)
// ---------------------------------------------------------------------------

/**
 * Les membres de Skool « a ce compte » ($1 = uuid) : rattaches (profile_id),
 * ou pas encore rattaches et porteurs d'une adresse NON AMBIGUE qui est une
 * adresse verifiee du compte (memes regles que SQL_IDENTITE). Jamais par le
 * nom. La policy academie_skool_membres_lecture dit la meme chose.
 */
const CTE_MEMBRES_SKOOL = `
with emails as (
  select lower(btrim(u.email)) as e
    from auth.users u
   where u.id = $1::uuid and u.email is not null and u.email_confirmed_at is not null
  union
  select lower(btrim(pe.email))
    from public.profile_emails pe
   where pe.profile_id = $1::uuid and pe.verified = true and pe.email is not null
), membres as (
  select m.skool_member_id
    from public.academie_skool_membres m
   where m.profile_id = $1::uuid
      or (m.profile_id is null and m.email is not null and m.email_source <> 'ambigu-plusieurs-homonymes'
          and m.email in (select e from emails))
)`

/** $1 = compte. L'historique, l'arrivee dans l'academie et l'heure de la base. */
export const SQL_FAITS_REPRISE = `${CTE_MEMBRES_SKOOL}
select
  exists (
    select 1 from public.academie_progression_skool ps
     where ps.skool_member_id in (select skool_member_id from membres)
       and ps.lecons_terminees > 0 and ps.lecons_total > 0
  ) as releve_skool,
  exists (
    select 1 from public.aok_anciens_membres am
     where am.profile_id = $1::uuid and am.equipe = false
  ) as ancien,
  (select min(x.cree_le) from public.academie_lectures x where x.user_id = $1::uuid) as arrivee,
  now() as maintenant
`

/** $1 = compte. Son releve de Skool, par cours (pour les reperes). */
export const SQL_RELEVE_DU_COMPTE = `${CTE_MEMBRES_SKOOL}
select ps.skool_cours_id, ps.skool_cours_titre, ps.lecons_terminees, ps.lecons_total, ps.releve_le::text as releve_le
  from public.academie_progression_skool ps
 where ps.skool_member_id in (select skool_member_id from membres)
`

/** $1 = compte. Ses reprises (les deux modes : seul le mode membre compte pour le « une fois »). */
export const SQL_REPRISES_DU_COMPTE = `
select r.module_id::text as module_id, r.section_id::text as section_id, r.mode
  from public.academie_reprises r
 where r.user_id = $1::uuid
`

/** $1 = compte. Ses reprises de la derniere heure (garde-fou de debit). */
export const SQL_REPRISES_HEURE = `
select count(*)::int as n
  from public.academie_reprises r
 where r.user_id = $1::uuid and r.mode = 'membre' and r.cree_le > now() - interval '1 hour'
`

/**
 * La ligne du journal, AVANT les lecons : $1 compte, $2 module, $3 section
 * (ou null), $4 portee, $5 verrou, $6 lecons deja vues, $7 pourcentage de
 * Skool affiche (ou null). Aucune ligne rendue = deja utilise (index unique).
 */
export const SQL_POSER_REPRISE = `
insert into public.academie_reprises (user_id, module_id, section_id, portee, mode, par, verrou, deja_vues, pourcentage_skool)
values ($1::uuid, $2::uuid, $3::uuid, $4::text, 'membre', $1::uuid, $5::text, $6::int, $7::smallint)
on conflict (user_id, verrou) where mode = 'membre' do nothing
returning id::text as id
`

/**
 * Coche les lecons : $1 compte, $2 lecons (uuid[]). Une lecon sans ligne en
 * recoit une (jamais ouverte : nb_sessions = 0) ; une lecon ouverte ou en
 * cours passe vue ; une lecon deja vue (vu_le pose) n'est PAS touchee (le
 * where du on conflict). Jamais terminee_le ni marquee_vue_le : aucun point.
 * Seulement des lecons publiees d'un module publie. Rend les lecons cochees.
 */
export const SQL_COCHER_REPRISE = `
insert into public.academie_progression as p (user_id, lecon_id, derniere_vue_le, nb_sessions, vu_le, vu_par)
select $1::uuid, l.id, now(), 0, now(), 'reprise'
  from public.academie_lecons l
  join public.academie_modules m on m.id = l.module_id
 where l.id = any($2::uuid[]) and l.statut = 'publie' and m.statut = 'publie'
on conflict (user_id, lecon_id) do update set
  vu_le = now(),
  vu_par = 'reprise'
  where p.vu_le is null
returning p.lecon_id::text as lecon_id
`

/** $1 = id de la reprise, $2 = lecons reellement cochees (uuid[]). */
export const SQL_COMPLETER_REPRISE = `
update public.academie_reprises set lecons = $2::uuid[] where id = $1::uuid
`

// L'import du releve (scripts/importer-progression-skool.mjs), par lots.

/**
 * Les membres de Skool : $1 ids, $2 prenoms, $3 noms, $4 emails, $5 sources,
 * $6 statuts, $7 dates d'entree (texte AAAA-MM-JJ ou null), $8 date du
 * releve. Rejouable : une ligne inchangee n'est pas reecrite. Un rattachement
 * PAR EMAIL tombe si l'adresse change ou devient ambigue ; un rattachement a
 * la main (equipe, membre) reste. Rend { cree } par ligne ecrite.
 * Une adresse effacee (cockpit_oublis_emails : effacement de niveau 3 par
 * cockpit_effacer) est sautee : l'import ne recree pas une personne effacee.
 */
export const SQL_IMPORTER_MEMBRES = `
insert into public.academie_skool_membres as m
       (skool_member_id, prenom, nom, email, email_source, statut_skool, rejoint_skool, releve_le)
select t.id, t.prenom, t.nom, t.email, t.source, t.statut, t.rejoint::date, $8::date
  from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
       as t(id, prenom, nom, email, source, statut, rejoint)
 where t.email is null
    or not exists (select 1 from public.cockpit_oublis_emails o where o.email_hash = public.cockpit_hash_email(t.email))
on conflict (skool_member_id) do update set
  prenom = excluded.prenom,
  nom = excluded.nom,
  email = excluded.email,
  email_source = excluded.email_source,
  statut_skool = excluded.statut_skool,
  rejoint_skool = excluded.rejoint_skool,
  releve_le = greatest(m.releve_le, excluded.releve_le),
  profile_id = case when m.rattache_mode = 'email'
                     and (excluded.email is distinct from m.email or excluded.email_source = 'ambigu-plusieurs-homonymes')
                    then null else m.profile_id end,
  rattache_le = case when m.rattache_mode = 'email'
                      and (excluded.email is distinct from m.email or excluded.email_source = 'ambigu-plusieurs-homonymes')
                     then null else m.rattache_le end,
  rattache_mode = case when m.rattache_mode = 'email'
                        and (excluded.email is distinct from m.email or excluded.email_source = 'ambigu-plusieurs-homonymes')
                       then null else m.rattache_mode end,
  maj_le = now()
  where (m.prenom, m.nom, m.email, m.email_source, m.statut_skool, m.rejoint_skool)
        is distinct from (excluded.prenom, excluded.nom, excluded.email, excluded.email_source, excluded.statut_skool, excluded.rejoint_skool)
     or m.releve_le < excluded.releve_le
returning (xmax = 0) as cree
`

/**
 * Le releve par cours : $1 membres, $2 cours, $3 titres, $4 lecons
 * terminees, $5 lecons du cours, $6 pourcentages, $7 acces (bool ou null),
 * $8 date du releve. Rejouable (cle membre, cours, date). Rend { cree }.
 * Seulement pour un membre de Skool present : un membre efface (saute par
 * SQL_IMPORTER_MEMBRES) ne recoit pas son releve.
 */
export const SQL_IMPORTER_COURS = `
insert into public.academie_progression_skool as p
       (skool_member_id, skool_cours_id, skool_cours_titre, lecons_terminees, lecons_total, pourcentage, a_acces, releve_le)
select t.membre, t.cours, t.titre, t.terminees, t.total, t.pc, t.acces, $8::date
  from unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::int[], $6::smallint[], $7::boolean[])
       as t(membre, cours, titre, terminees, total, pc, acces)
 where exists (select 1 from public.academie_skool_membres m where m.skool_member_id = t.membre)
on conflict (skool_member_id, skool_cours_id, releve_le) do update set
  skool_cours_titre = excluded.skool_cours_titre,
  lecons_terminees = excluded.lecons_terminees,
  lecons_total = excluded.lecons_total,
  pourcentage = excluded.pourcentage,
  a_acces = excluded.a_acces
  where (p.skool_cours_titre, p.lecons_terminees, p.lecons_total, p.pourcentage, p.a_acces)
        is distinct from (excluded.skool_cours_titre, excluded.lecons_terminees, excluded.lecons_total, excluded.pourcentage, excluded.a_acces)
returning (xmax = 0) as cree
`

/**
 * Les adresses verifiees sur UN SEUL compte du site ($1 = adresses, en
 * minuscules) : celles qu'un rattachement par email peut prendre. Une adresse
 * verifiee sur deux comptes n'est jamais prise. L'essai a blanc s'en sert
 * pour compter (rien n'est affiche que des nombres).
 */
export const SQL_ADRESSES_RATTACHABLES = `
with comptes as (
  select lower(btrim(u.email)) as e, u.id
    from auth.users u
   where u.email is not null and u.email_confirmed_at is not null and lower(btrim(u.email)) = any($1::text[])
  union
  select lower(btrim(pe.email)), pe.profile_id
    from public.profile_emails pe
   where pe.verified = true and pe.email is not null and lower(btrim(pe.email)) = any($1::text[])
)
select c.e as email
  from comptes c
  join public.profiles p on p.id = c.id
 group by c.e
having count(distinct c.id) = 1
`

/**
 * Le rattachement automatique PAR EMAIL des membres pas encore rattaches :
 * adresse non ambigue, verifiee sur un seul compte du site. Jamais par le
 * nom. Rejouable (apres l'import, puis quand de nouveaux comptes arrivent).
 * Rend les membres rattaches (leur id de Skool, jamais l'adresse).
 */
export const SQL_RATTACHER_PAR_EMAIL = `
with comptes as (
  select lower(btrim(u.email)) as e, u.id
    from auth.users u
   where u.email is not null and u.email_confirmed_at is not null
  union
  select lower(btrim(pe.email)), pe.profile_id
    from public.profile_emails pe
   where pe.verified = true and pe.email is not null
), uniques as (
  select c.e, (array_agg(distinct c.id))[1] as id
    from comptes c
    join public.profiles p on p.id = c.id
   group by c.e
  having count(distinct c.id) = 1
)
update public.academie_skool_membres m set
  profile_id = u.id,
  rattache_mode = 'email',
  rattache_par = null,
  rattache_le = now(),
  maj_le = now()
  from uniques u
 where u.e = m.email
   and m.profile_id is null
   and m.email is not null
   and m.email_source not in ('aucune', 'ambigu-plusieurs-homonymes')
returning m.skool_member_id
`
