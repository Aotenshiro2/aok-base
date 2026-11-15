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
// (15/11/2026 soir, brief 2026-11-15-academie-reprise-auto, go de Brice) Le
// RATTACHEMENT AUTOMATIQUE (par email ou par nom, en recoupant tout ce que le
// site et le cockpit savent de la personne, sans ambiguite) et le
// PRE-REMPLISSAGE de l'avancee de Skool (mode 'auto' du journal des reprises),
// en fin de fichier. Migration : 20261115200000_academie_reprise_auto.sql.
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

/**
 * La cle du « une fois » ecrite dans academie_reprises.verrou (mode membre, et
 * mode auto : le pre-remplissage pose le MEME verrou que le bouton, l'index
 * unique couvre les deux modes depuis 20261115200000).
 */
export function verrouReprise(regle: RegleUneFois, moduleId: string, sectionId: string | null): string {
  if (regle === 'cible' && sectionId) return `section:${sectionId}`
  return `module:${moduleId}`
}

/** membre = le bouton ; auto = le pre-remplissage depuis Skool (15/11 soir) ; equipe = un geste de l'equipe. */
export type ModeReprise = 'membre' | 'equipe' | 'auto'
/** Les modes qui consomment le « une fois » (et cachent le bouton). */
export const MODES_UNE_FOIS: readonly ModeReprise[] = ['membre', 'auto']

export type RepriseFaite = { moduleId: string; sectionId: string | null; mode: ModeReprise; lecons?: number }

/**
 * Le compte a-t-il deja utilise son « Deja vu avant » pour cette cible, ou le
 * cours a-t-il ete pre-rempli depuis Skool (mode auto) ? Les gestes de
 * l'equipe ne comptent pas.
 */
export function dejaFaite(regle: RegleUneFois, faites: readonly RepriseFaite[], moduleId: string, sectionId: string | null): boolean {
  const miennes = faites.filter(f => MODES_UNE_FOIS.includes(f.mode) && f.moduleId === moduleId)
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

/**
 * Les cours de Skool qui font un historique : seulement ceux qui ont un
 * equivalent dans l'academie (module non vide, sur ou douteux). Brice, 15/11,
 * carte academie-reprise-mise-en-ligne en A : un membre qui n'a fini que
 * « Initiation Skool » (le mode d'emploi de Skool) n'a rien vu de nos cours.
 */
export const COURS_SKOOL_HISTORIQUE: ReadonlySet<string> = new Set(
  CORRESPONDANCE_SKOOL.filter(c => c.module !== null).map(c => c.skool),
)
for (const id of COURS_SKOOL_HISTORIQUE) {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error(`id de cours Skool invalide dans CORRESPONDANCE_SKOOL : ${id}`)
}
const LISTE_SQL_COURS_HISTORIQUE = [...COURS_SKOOL_HISTORIQUE].map(id => `'${id}'`).join(', ')

export type MembreReleve = {
  skoolMemberId: string
  prenom: string | null
  nom: string | null
  email: string | null
  emailSource: SourceEmail
  statut: 'actif' | 'parti' | null
  rejoint: string | null
  /** Au moins une lecon terminee dans un cours qui a son equivalent (COURS_SKOOL_HISTORIQUE) : l'historique de la regle. */
  historique: boolean
  /** Les lignes du membre ne disent pas toutes la meme chose (adresse, nom) : la premiere est gardee. */
  incoherent: boolean
}

/** Les membres du releve (une entree par skool_member_id), sans les cours vides de Skool. */
export function membresDuReleve(lignes: readonly LigneReleve[], coursVides: ReadonlySet<string> = new Set()): Map<string, MembreReleve> {
  const sortie = new Map<string, MembreReleve>()
  for (const l of lignes) {
    const deja = sortie.get(l.skoolMemberId)
    const compte = !coursVides.has(l.coursId) && l.terminees > 0 && COURS_SKOOL_HISTORIQUE.has(l.coursId)
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
       and ps.skool_cours_id in (${LISTE_SQL_COURS_HISTORIQUE})
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

/**
 * $1 = compte. Ses reprises (tous les modes : membre et auto comptent pour le
 * « une fois », equipe non), avec le nombre de lecons cochees.
 */
export const SQL_REPRISES_DU_COMPTE = `
select r.module_id::text as module_id, r.section_id::text as section_id, r.mode, cardinality(r.lecons)::int as lecons
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
 * PAR EMAIL tombe si l'adresse change ou devient ambigue, un rattachement PAR
 * NOM (20261115200000) si le prenom ou le nom change : le compte se rattache
 * de nouveau a son prochain passage par /moi si c'est toujours sans
 * ambiguite. Un rattachement a la main (equipe, membre) reste. Rend { cree }
 * par ligne ecrite.
 * Une adresse effacee (cockpit_oublis_emails : effacement de niveau 3 par
 * cockpit_effacer) est sautee : l'import ne recree pas une personne effacee.
 */
const RATTACHEMENT_ROMPU = `m.rattache_mode = 'email'
                     and (excluded.email is distinct from m.email or excluded.email_source = 'ambigu-plusieurs-homonymes')
                     or m.rattache_mode = 'nom' and (excluded.prenom, excluded.nom) is distinct from (m.prenom, m.nom)`

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
  profile_id = case when ${RATTACHEMENT_ROMPU} then null else m.profile_id end,
  rattache_le = case when ${RATTACHEMENT_ROMPU} then null else m.rattache_le end,
  rattache_source = case when ${RATTACHEMENT_ROMPU} then null else m.rattache_source end,
  rattache_mode = case when ${RATTACHEMENT_ROMPU} then null else m.rattache_mode end,
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

// ---------------------------------------------------------------------------
// Le RATTACHEMENT AUTOMATIQUE (15/11/2026 soir, brief
// 2026-11-15-academie-reprise-auto, points 1 et 1 bis, go de Brice)
// ---------------------------------------------------------------------------
//
// Brice : « Ca sert a quoi d'avoir toutes les infos sur les membres dans le
// cockpit si a chaque fois tu limites les recoupements de donnees a une
// entree ? » Le rattachement rassemble donc TOUTES les identites connues de la
// personne, puis compare avec celles du membre de Skool.
//
// Les emails d'un compte du site :
//   connexion   l'email de connexion verifie (auth.users.email_confirmed_at) ;
//   secondaire  les emails VERIFIES de profile_emails (un email non verifie ne
//               sert pas : n'importe qui pourrait ajouter l'adresse d'un autre) ;
//   invitation  l'email de l'invitation qui a cree le compte ;
//   acces       les emails des acces de l'academie poses sur ce compte ;
//   fiche       tous les emails de la fiche du cockpit de la personne, trouvee
//               par n'importe lequel des emails ci-dessus (cockpit_membre_emails) ;
//   paiement    les payeur_email des paiements de cette fiche.
// Les noms d'un compte : prenom et nom du profil (profil), de la fiche (fiche).
// Un membre de Skool : son email (hors 'aucune' et 'ambigu-plusieurs-homonymes'),
// son prenom et son nom.
//
// La regle (deciderRattachements, ci-dessous, la meme pour /moi et les scripts) :
//   - par l'email d'abord : un email du compte est celui du membre (mode email) ;
//     sinon par le nom : un nom normalise du compte est exactement celui du
//     membre (mode nom), prenom ET nom non vides, et ce nom n'appartient qu'a UN
//     SEUL membre de Skool ;
//   - SANS AMBIGUITE, dans les deux sens : le compte ne retrouve qu'un membre,
//     et ce membre ne retrouve que ce compte (meme priorite : l'email, puis le nom) ;
//   - jamais un membre deja rattache, jamais un compte deja rattache ;
//   - une personne effacee ne revient pas : un email du compte ou du membre
//     dans cockpit_oublis_emails, et rien ne se fait.
// Le rattachement garde sa source (rattache_source), jamais un email ni un nom.

export type ModeAuto = 'email' | 'nom'
export const SOURCES_RATTACHEMENT_EMAIL = ['connexion', 'secondaire', 'invitation', 'acces', 'fiche', 'paiement'] as const
export const SOURCES_RATTACHEMENT_NOM = ['profil', 'fiche'] as const
export type SourceRattachement = (typeof SOURCES_RATTACHEMENT_EMAIL)[number] | (typeof SOURCES_RATTACHEMENT_NOM)[number]

// La normalisation d'un nom : minuscules, sans accents, espaces reduits. La
// MEME table sert au SQL (translate) et a normaliserNom (verifications).
const LETTRES_ACCENTUEES: readonly (readonly [string, string])[] = [
  ['àáâãäåāăą', 'a'], ['çćĉċč', 'c'], ['ďđ', 'd'], ['èéêëēĕėęě', 'e'], ['ĝğġģ', 'g'], ['ĥħ', 'h'],
  ['ìíîïĩīĭįı', 'i'], ['ĵ', 'j'], ['ķ', 'k'], ['ĺļľŀł', 'l'], ['ñńņň', 'n'], ['òóôõöøōŏő', 'o'],
  ['ŕŗř', 'r'], ['śŝşš', 's'], ['ţťŧ', 't'], ['ùúûüũūŭůűų', 'u'], ['ŵ', 'w'], ['ýÿŷ', 'y'], ['źżž', 'z'],
]
const AVEC = [...LETTRES_ACCENTUEES.map(([a]) => a).join(''), ' ']
const SANS = [...LETTRES_ACCENTUEES.map(([a, b]) => b.repeat([...a].length)).join(''), ' ']
if (AVEC.length !== SANS.length) throw new Error('table des accents incoherente')

/** Un nom normalise (minuscules, sans accents, espaces reduits), ou null s'il est vide. */
export function normaliserNom(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let t = ''
  for (const c of v.toLowerCase()) {
    const i = AVEC.indexOf(c)
    t += i >= 0 ? SANS[i] : c
  }
  t = t.replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim()
  return t || null
}

/** La meme normalisation en SQL (null si vide). */
export function sqlNomNormalise(colonne: string): string {
  return `nullif(btrim(regexp_replace(replace(replace(replace(translate(lower(coalesce(${colonne}, '')), '${AVEC.join('')}', '${SANS.join('')}'), 'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'), '\\s+', ' ', 'g')), '')`
}

const rangSource = (s: SourceRattachement, mode: ModeAuto): number =>
  (mode === 'email' ? SOURCES_RATTACHEMENT_EMAIL : SOURCES_RATTACHEMENT_NOM).indexOf(s as never)

/**
 * Les couples possibles (compte, membre de Skool), avec leur mode, leur
 * meilleure source et ce qu'il faut pour decider. Une ligne par (compte,
 * membre, mode). homonymes = le nombre de membres de Skool qui portent ce nom
 * (1 pour le mode email).
 */
const CTE_PAIRES = `
with directs as (
  select u.id, lower(btrim(u.email)) as e, 'connexion'::text as src, 1 as rang
    from auth.users u
   where u.email is not null and u.email_confirmed_at is not null
  union all
  select pe.profile_id, lower(btrim(pe.email)), 'secondaire', 2
    from public.profile_emails pe
   where pe.verified = true and pe.email is not null
  union all
  select i.user_id, lower(btrim(i.email)), 'invitation', 3
    from public.academie_invitations i
   where i.user_id is not null and i.email is not null
  union all
  select a.user_id, lower(btrim(a.email)), 'acces', 4
    from public.academie_acces a
   where a.user_id is not null and a.email is not null
), fiches as (
  select distinct d.id, f.membre_id
    from directs d
    join public.cockpit_membre_emails f on lower(btrim(f.email)) = d.e
), emails as (
  select d.id, d.e, d.src, d.rang from directs d
  union all
  select fi.id, lower(btrim(f.email)), 'fiche', 5
    from fiches fi
    join public.cockpit_membre_emails f on f.membre_id = fi.membre_id
  union all
  select fi.id, lower(btrim(p.payeur_email)), 'paiement', 6
    from fiches fi
    join public.cockpit_paiements p on p.membre_id = fi.membre_id
   where p.payeur_email is not null
), noms as (
  select p.id, ${sqlNomNormalise('p.first_name')} as pn, ${sqlNomNormalise('p.last_name')} as nn, 'profil'::text as src, 1 as rang
    from public.profiles p
  union all
  select fi.id, ${sqlNomNormalise('c.prenom')}, ${sqlNomNormalise('c.nom')}, 'fiche', 2
    from fiches fi
    join public.cockpit_membres c on c.membre_id = fi.membre_id
), skool as (
  select m.skool_member_id as s, m.email, m.email_source,
         ${sqlNomNormalise('m.prenom')} as pn, ${sqlNomNormalise('m.nom')} as nn
    from public.academie_skool_membres m
), skool_noms as (
  select k.s, k.pn, k.nn, count(*) over (partition by k.pn, k.nn) as homonymes
    from skool k
   where k.pn is not null and k.nn is not null
), paires as (
  select distinct on (x.id, x.s, x.mode) x.id, x.s, x.mode, x.src, x.homonymes
    from (
      select e.id, k.s, 'email'::text as mode, e.src, e.rang, 1::bigint as homonymes
        from emails e
        join skool k on k.email = e.e
       where k.email_source not in ('aucune', 'ambigu-plusieurs-homonymes')
      union all
      select n.id, k.s, 'nom', n.src, n.rang, k.homonymes
        from noms n
        join skool_noms k on k.pn = n.pn and k.nn = n.nn
       where n.pn is not null and n.nn is not null
    ) x
    join public.profiles p on p.id = x.id
   order by x.id, x.s, x.mode, x.rang
)
select q.id::text as compte, q.s as membre, q.mode, q.src as source, q.homonymes::int as homonymes,
       exists (select 1 from public.academie_skool_membres r where r.profile_id = q.id) as compte_relie,
       exists (select 1 from public.academie_skool_membres r where r.skool_member_id = q.s and r.profile_id is not null) as membre_relie,
       (exists (select 1 from emails e join public.cockpit_oublis_emails o on o.email_hash = public.cockpit_hash_email(e.e)
                 where e.id = q.id)
        or exists (select 1 from skool k join public.cockpit_oublis_emails o on o.email_hash = public.cockpit_hash_email(k.email)
                    where k.s = q.s and k.email is not null)) as oublie
  from paires q`

/** Tous les couples possibles (le script de rattrapage et l'import, a blanc ou pour de vrai). */
export const SQL_PAIRES_RATTACHEMENT = `${CTE_PAIRES}
 order by 1, 2, 3
`

/**
 * $1 = compte : les couples qui touchent un membre que ce compte retrouve
 * (tous les comptes de ces membres, pour la verification dans les deux sens).
 * Vide pour un compte qui ne retrouve personne : le cas courant, leger.
 */
export const SQL_PAIRES_RATTACHEMENT_COMPTE = `${CTE_PAIRES}
 where q.s in (select z.s from paires z where z.id = $1::uuid)
 order by 1, 2, 3
`

/**
 * Le rattachement automatique, garde par la base : $1 compte, $2 membre de
 * Skool, $3 mode (email, nom), $4 source. Ni un membre deja rattache, ni un
 * compte deja rattache (deux passages simultanes : le second ne trouve plus
 * profile_id vide). Rend le membre rattache (aucune ligne = rien fait).
 */
export const SQL_RATTACHER_AUTO = `
update public.academie_skool_membres m set
  profile_id = $1::uuid,
  rattache_mode = $3::text,
  rattache_source = $4::text,
  rattache_par = null,
  rattache_le = now(),
  maj_le = now()
 where m.skool_member_id = $2::text
   and m.profile_id is null
   and $3::text in ('email', 'nom')
   and not exists (select 1 from public.academie_skool_membres x where x.profile_id = $1::uuid)
   and exists (select 1 from public.profiles p where p.id = $1::uuid)
returning m.skool_member_id
`

/**
 * Le rattachement A LA MAIN (equipe) : $1 membre de Skool, $2 compte, $3 le
 * compte d'equipe qui l'a decide. Seulement si ni le membre ni le compte ne
 * sont deja rattaches : un filet, qui ne joue que si l'automatique n'a rien fait.
 */
export const SQL_RATTACHER_A_LA_MAIN = `
update public.academie_skool_membres m set
  profile_id = $2::uuid,
  rattache_mode = 'equipe',
  rattache_source = null,
  rattache_par = $3::uuid,
  rattache_le = now(),
  maj_le = now()
 where m.skool_member_id = $1::text
   and m.profile_id is null
   and not exists (select 1 from public.academie_skool_membres x where x.profile_id = $2::uuid)
   and exists (select 1 from public.profiles p where p.id = $2::uuid)
returning m.skool_member_id
`

/** Brice (le compte d'equipe qui a confirme les rattachements a la main du 15/11). */
export const COMPTE_BRICE = '0636a40b-13a4-4fe8-af11-d060e2810767'

/**
 * Les rattachements A LA MAIN, confirmes par Brice dans la conversation de
 * l'orchestre le 15/11 : un membre de Skool vers un compte du site, mode
 * equipe. Un filet : ils ne jouent que si l'automatique ne les a pas faits.
 * Ni email ni nom ici : des identifiants.
 */
export const RATTACHEMENTS_A_LA_MAIN: readonly { membre: string; compte: string; par: string; note: string }[] = [
  { membre: '91b8c4f373e54933a8efd6afd043d8c1', compte: 'ef210909-1b85-4c60-a408-b6ad232a8eef', par: COMPTE_BRICE,
    note: 'Son compte a un autre email que Skool et pas de nom de famille (confirme par Brice le 15/11).' },
]

export type PaireRattachement = {
  compte: string
  membre: string
  mode: ModeAuto
  source: SourceRattachement
  /** Le nombre de membres de Skool qui portent ce nom (1 en mode email). */
  homonymes: number
  compteRelie: boolean
  membreRelie: boolean
  /** Un email du compte ou du membre est dans la liste d'oubli (personne effacee). */
  oublie: boolean
}

type LignePaire = {
  compte: string; membre: string; mode: string; source: string; homonymes: number | bigint
  compte_relie: boolean; membre_relie: boolean; oublie: boolean
}

/** Les lignes de SQL_PAIRES_RATTACHEMENT(_COMPTE) en couples (une ligne illisible est ecartee). */
export function lirePaires(lignes: readonly LignePaire[]): PaireRattachement[] {
  const sortie: PaireRattachement[] = []
  for (const l of lignes) {
    const mode = l.mode === 'email' || l.mode === 'nom' ? l.mode : null
    if (!mode) continue
    const sources: readonly string[] = mode === 'email' ? SOURCES_RATTACHEMENT_EMAIL : SOURCES_RATTACHEMENT_NOM
    if (!sources.includes(l.source)) continue
    sortie.push({
      compte: String(l.compte), membre: String(l.membre), mode, source: l.source as SourceRattachement,
      homonymes: Number(l.homonymes) || 0,
      compteRelie: l.compte_relie === true, membreRelie: l.membre_relie === true, oublie: l.oublie === true,
    })
  }
  return sortie
}

export type Rattachement = { compte: string; membre: string; mode: ModeAuto; source: SourceRattachement }
export type MotifRefusRattachement =
  | 'ambigu_compte' // le compte retrouve plusieurs membres de Skool
  | 'ambigu_membre' // le membre retrouve plusieurs comptes (ou un autre compte en priorite)
  | 'membre_relie' // le membre est deja rattache a un autre compte
  | 'oublie' // personne effacee

export type DecisionRattachements = {
  rattachements: Rattachement[]
  refus: { compte: string; membre: string | null; motif: MotifRefusRattachement }[]
  /** Comptes deja rattaches qui retrouvent un membre (rien a faire). */
  dejaRelies: number
  /** Comptes rattaches par l'email alors qu'un nom designe un AUTRE membre (la priorite a l'email a tranche). */
  emailContreNom: number
  /** Comptes pas encore rattaches qui ne retrouvent un membre que par un nom porte par plusieurs membres de Skool. */
  nomsHomonymes: number
}

type Choix = { id: string; mode: ModeAuto; source: SourceRattachement } | 'ambigu' | null

/** Un seul choix, l'email d'abord, puis le nom (un nom porte par plusieurs membres de Skool ne compte pas). */
function choisir(liste: readonly PaireRattachement[], cle: 'membre' | 'compte'): Choix {
  const email = liste.filter(p => p.mode === 'email')
  const retenues = email.length ? email : liste.filter(p => p.mode === 'nom')
  const ids = new Set(retenues.map(p => p[cle]))
  if (ids.size === 0) return null
  if (ids.size > 1) return 'ambigu'
  const meilleure = [...retenues].sort((a, b) => rangSource(a.source, a.mode) - rangSource(b.source, b.mode))[0]
  return { id: meilleure[cle], mode: meilleure.mode, source: meilleure.source }
}

/**
 * LA decision, la meme partout : un compte pas encore rattache est rattache a
 * un membre de Skool quand le compte ne retrouve que lui ET qu'il ne retrouve
 * que ce compte (l'email d'abord, puis le nom), que le membre n'est pas deja
 * rattache et que personne n'a ete efface. Tout le reste attend un
 * rattachement a la main (volet 3 du cockpit).
 */
export function deciderRattachements(paires: readonly PaireRattachement[]): DecisionRattachements {
  const valides = paires.filter(p => p.mode === 'email' || p.homonymes === 1)
  const parCompte = new Map<string, PaireRattachement[]>()
  const parMembre = new Map<string, PaireRattachement[]>()
  for (const p of valides) {
    parCompte.set(p.compte, [...(parCompte.get(p.compte) ?? []), p])
    parMembre.set(p.membre, [...(parMembre.get(p.membre) ?? []), p])
  }
  const decision: DecisionRattachements = { rattachements: [], refus: [], dejaRelies: 0, emailContreNom: 0, nomsHomonymes: 0 }
  const homonymes = new Set(paires.filter(p => !p.compteRelie && !parCompte.has(p.compte)).map(p => p.compte))
  decision.nomsHomonymes = homonymes.size
  for (const [compte, liste] of [...parCompte].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (liste.some(p => p.compteRelie)) { decision.dejaRelies++; continue }
    const aller = choisir(liste, 'membre')
    if (aller === null) continue
    if (aller === 'ambigu') { decision.refus.push({ compte, membre: null, motif: 'ambigu_compte' }); continue }
    // Un membre deja rattache (a un autre compte : celui-ci ne l'est pas) n'est jamais touche.
    if (liste.some(p => p.membre === aller.id && p.membreRelie)) {
      decision.refus.push({ compte, membre: aller.id, motif: 'membre_relie' })
      continue
    }
    const retour = choisir(parMembre.get(aller.id) ?? [], 'compte')
    if (retour === null || retour === 'ambigu' || retour.id !== compte || retour.mode !== aller.mode) {
      decision.refus.push({ compte, membre: aller.id, motif: 'ambigu_membre' })
      continue
    }
    if (liste.some(p => p.oublie) || (parMembre.get(aller.id) ?? []).some(p => p.oublie)) {
      decision.refus.push({ compte, membre: aller.id, motif: 'oublie' })
      continue
    }
    if (aller.mode === 'email' && liste.some(p => p.mode === 'nom' && p.membre !== aller.id)) decision.emailContreNom++
    decision.rattachements.push({ compte, membre: aller.id, mode: aller.mode, source: aller.source })
  }
  return decision
}

// ---------------------------------------------------------------------------
// Le PRE-REMPLISSAGE de l'avancee de Skool (point 2 du brief)
// ---------------------------------------------------------------------------
//
// Des qu'un compte est rattache (quel que soit le mode) et a un releve, chaque
// cours de Skool de CORRESPONDANCE_SKOOL qui a un module ET sure = true est
// rempli (les deux cours douteux gardent seulement le bouton) :
//   - cours fini (lecons terminees >= lecons du cours) : toutes les lecons
//     publiees du module, ou de la partie quand le cours correspond a une partie ;
//   - cours en partie fait : les premieres lecons publiees, dans l'ordre de
//     l'academie (lecons sans partie, puis les parties, puis les lecons), au
//     meme pourcentage : round(terminees / total x N), au moins 1 ;
//   - une lecon qui a deja une ligne de progression (vue, ouverte, cochee) n'est
//     JAMAIS touchee : on n'ajoute que les lecons manquantes ;
//   - les memes marques que le bouton : vu_le et vu_par = 'reprise', nb_sessions
//     = 0, ni terminee_le ni marquee_vue_le, aucun temps, aucun point ;
//   - une ligne academie_reprises en mode auto (par vide), avec le MEME verrou
//     que le bouton : le bouton disparait pour ce cours, le « une fois » tient en
//     base, un deuxieme passage n'ajoute rien. Pas de fenetre de 30 jours.

/** Les cours de Skool qui se remplissent tout seuls : un module, et une correspondance sure. */
export const COURS_SKOOL_REMPLIS: ReadonlySet<string> = new Set(
  CORRESPONDANCE_SKOOL.filter(c => c.module !== null && c.sure).map(c => c.skool),
)
const LISTE_SQL_COURS_REMPLIS = [...COURS_SKOOL_REMPLIS].map(id => `'${id}'`).join(', ')

/**
 * $1 = compte. En une lecture : rattache ou non, le releve de ses membres de
 * Skool rattaches (cours remplis seulement), et les verrous deja poses (bouton
 * ou pre-remplissage).
 */
export const SQL_ETAT_AUTO = `
select
  exists (select 1 from public.academie_skool_membres m where m.profile_id = $1::uuid) as relie,
  coalesce((
    select json_agg(json_build_object('cours', ps.skool_cours_id, 'titre', ps.skool_cours_titre,
                                      'terminees', ps.lecons_terminees, 'total', ps.lecons_total, 'le', ps.releve_le::text))
      from public.academie_progression_skool ps
      join public.academie_skool_membres m on m.skool_member_id = ps.skool_member_id
     where m.profile_id = $1::uuid and ps.lecons_total > 0
       and ps.skool_cours_id in (${LISTE_SQL_COURS_REMPLIS})
  ), '[]'::json) as releve,
  coalesce((
    select array_agg(r.verrou)
      from public.academie_reprises r
     where r.user_id = $1::uuid and r.mode in ('membre', 'auto') and r.verrou is not null
  ), '{}'::text[]) as verrous
`

// Les memes lectures pour toute la base (scripts/rattraper-reprise-skool.mjs).

/** Le releve des cours remplis, de tous les membres de Skool (rattaches ou non). */
export const SQL_RELEVE_REMPLIS_TOUS = `
select ps.skool_member_id as membre, m.profile_id::text as compte, ps.skool_cours_id as cours, ps.skool_cours_titre as titre,
       ps.lecons_terminees as terminees, ps.lecons_total as total, ps.releve_le::text as le
  from public.academie_progression_skool ps
  join public.academie_skool_membres m on m.skool_member_id = ps.skool_member_id
 where ps.lecons_total > 0 and ps.skool_cours_id in (${LISTE_SQL_COURS_REMPLIS})
`

/** Les verrous deja poses (bouton ou pre-remplissage), de tous les comptes. */
export const SQL_VERROUS_TOUS = `
select r.user_id::text as compte, r.verrou
  from public.academie_reprises r
 where r.mode in ('membre', 'auto') and r.verrou is not null
`

/** Les membres de Skool qui ont un historique (au moins une lecon terminee dans un cours qui a son equivalent). */
export const SQL_MEMBRES_AVEC_HISTORIQUE = `
select distinct ps.skool_member_id as membre
  from public.academie_progression_skool ps
 where ps.lecons_terminees > 0 and ps.lecons_total > 0
   and ps.skool_cours_id in (${LISTE_SQL_COURS_HISTORIQUE})
`

/** $1 = comptes, $2 = lecons : les lignes de progression qui existent deja (jamais touchees). */
export const SQL_PROGRESSION_EXISTANTE = `
select p.user_id::text as compte, p.lecon_id::text as lecon
  from public.academie_progression p
 where p.user_id = any($1::uuid[]) and p.lecon_id = any($2::uuid[])
`

type LigneReleveJson = { cours: string; titre: string; terminees: number; total: number; le: string }

/** Le releve tel que SQL_ETAT_AUTO le rend, en lignes de releve. */
export function releveDeJson(v: unknown): LigneReleveCompte[] {
  const liste = Array.isArray(v) ? v as LigneReleveJson[] : []
  return liste
    .filter(l => l && typeof l.cours === 'string')
    .map(l => ({
      skoolCoursId: l.cours, skoolCoursTitre: String(l.titre ?? ''), leconsTerminees: Number(l.terminees) || 0,
      leconsTotal: Number(l.total) || 0, releveLe: String(l.le ?? ''),
    }))
}

export type CatalogueRemplissage = {
  modules: readonly { id: string; slug: string; statut: string; lienExterne: string | null }[]
  sections: readonly { id: string; moduleId: string; ordre: number; titre: string }[]
  lecons: readonly { id: string; moduleId: string; sectionId: string | null; ordre: number; titre: string; statut: string }[]
}

const parOrdre = <T extends { ordre: number; titre: string }>(a: T, b: T) =>
  a.ordre - b.ordre || (a.titre < b.titre ? -1 : a.titre > b.titre ? 1 : 0)

/**
 * Les lecons PUBLIEES d'un module, dans l'ordre de l'academie : celles sans
 * partie (ou d'une partie inconnue) d'abord, puis chaque partie dans son
 * ordre, ses lecons dans leur ordre. sectionId : seulement cette partie.
 */
export function leconsDansLOrdre(cat: CatalogueRemplissage, moduleId: string, sectionId: string | null = null): string[] {
  const sections = cat.sections.filter(s => s.moduleId === moduleId).sort(parOrdre)
  const publiees = cat.lecons.filter(l => l.moduleId === moduleId && l.statut === 'publie').sort(parOrdre)
  const connues = new Set(sections.map(s => s.id))
  const ordre = [
    ...publiees.filter(l => !l.sectionId || !connues.has(l.sectionId)),
    ...sections.flatMap(s => publiees.filter(l => l.sectionId === s.id)),
  ]
  return ordre.filter(l => sectionId === null || l.sectionId === sectionId).map(l => l.id)
}

/** Combien de lecons cocher pour un cours : tout s'il est fini, sinon la meme part, au moins 1 si Skool en montre une. */
export function nombreACocher(terminees: number, total: number, publiees: number): number {
  if (!(total > 0) || !(publiees > 0) || !(terminees > 0)) return 0
  if (terminees >= total) return publiees
  return Math.min(publiees, Math.max(1, Math.round((terminees / total) * publiees)))
}

export type CoursRempli = {
  skool: string
  titre: string
  fini: boolean
  terminees: number
  total: number
  /** Lecons publiees de la cible dans l'academie. */
  publiees: number
  /** Lecons visees (les premieres, dans l'ordre). */
  visees: number
}

export type ItemRemplissage = {
  verrou: string
  moduleId: string
  sectionId: string | null
  portee: 'module' | 'section'
  /** Les lecons visees, dans l'ordre de l'academie (celles qui ont deja une ligne seront laissees). */
  lecons: string[]
  /** Le repere de Skool de la cible, garde dans le journal (null = aucun). */
  pourcentage: number | null
  cours: CoursRempli[]
}

/**
 * Ce que le pre-remplissage ferait pour un compte rattache : un item par
 * verrou pas encore pose. Le dernier releve de chaque cours ; deux membres de
 * Skool sur le meme compte : le plus avance. Un module non publie, un lien
 * externe ou une cible sans lecon publiee : rien (le cours sera rempli quand
 * il aura des lecons).
 */
export function planRemplissage(p: {
  releve: readonly LigneReleveCompte[]
  catalogue: CatalogueRemplissage
  verrousFaits: ReadonlySet<string> | readonly string[]
  regle?: RegleUneFois
  liste?: readonly CorrespondanceSkool[]
}): ItemRemplissage[] {
  const regle = p.regle ?? REPRISE_UNE_FOIS_PAR
  const liste = p.liste ?? CORRESPONDANCE_SKOOL
  const faits = new Set(p.verrousFaits)
  const parCours = new Map<string, LigneReleveCompte>()
  for (const l of p.releve) {
    if (!(l.leconsTotal > 0)) continue
    const avant = parCours.get(l.skoolCoursId)
    if (!avant || l.releveLe > avant.releveLe || (l.releveLe === avant.releveLe && l.leconsTerminees > avant.leconsTerminees)) {
      parCours.set(l.skoolCoursId, l)
    }
  }
  const reperes = reperesSkool(p.releve, p.catalogue, liste)
  const items = new Map<string, ItemRemplissage & { cibles: Set<string>; entier: boolean; parties: Set<string> }>()
  for (const l of [...parCours.values()].sort((a, b) => (a.skoolCoursId < b.skoolCoursId ? -1 : 1))) {
    if (!(l.leconsTerminees > 0)) continue
    const c = correspondanceDe(l.skoolCoursId, l.skoolCoursTitre, liste)
    if (!c || !c.module || !c.sure) continue
    const m = p.catalogue.modules.find(x => x.slug === c.module)
    if (!m || m.statut !== 'publie' || m.lienExterne) continue
    let sectionId: string | null = null
    if (c.section) {
      const prefixe = normaliserTitre(c.section)
      const s = p.catalogue.sections.find(x => x.moduleId === m.id && normaliserTitre(x.titre).startsWith(prefixe))
      if (!s) continue
      sectionId = s.id
    }
    const publiees = leconsDansLOrdre(p.catalogue, m.id, sectionId)
    const n = nombreACocher(l.leconsTerminees, l.leconsTotal, publiees.length)
    if (n === 0) continue
    const verrou = verrouReprise(regle, m.id, sectionId)
    if (faits.has(verrou)) continue
    const item = items.get(verrou) ?? {
      verrou, moduleId: m.id, sectionId: null, portee: 'module' as const, lecons: [], pourcentage: null, cours: [],
      cibles: new Set<string>(), entier: false, parties: new Set<string>(),
    }
    for (const id of publiees.slice(0, n)) item.cibles.add(id)
    if (sectionId) item.parties.add(sectionId)
    else item.entier = true
    item.cours.push({
      skool: l.skoolCoursId, titre: c.titre, fini: l.leconsTerminees >= l.leconsTotal, terminees: l.leconsTerminees,
      total: l.leconsTotal, publiees: publiees.length, visees: n,
    })
    items.set(verrou, item)
  }
  return [...items.values()].map(({ cibles, entier, parties, ...item }) => {
    const seule = !entier && parties.size === 1 ? [...parties][0] : null
    const repere = reperes.get(seule ? `section:${seule}` : `module:${item.moduleId}`)
    return {
      ...item,
      sectionId: seule,
      portee: seule ? 'section' as const : 'module' as const,
      lecons: leconsDansLOrdre(p.catalogue, item.moduleId).filter(id => cibles.has(id)),
      pourcentage: repere?.pourcentage ?? null,
    }
  })
}

/**
 * La ligne du journal en mode auto, AVANT les lecons : $1 compte, $2 module,
 * $3 section (ou null), $4 portee, $5 verrou, $6 repere de Skool (ou null).
 * par vide. Aucune ligne rendue = deja fait (bouton ou passage precedent :
 * l'index unique couvre membre ET auto).
 */
export const SQL_POSER_REPRISE_AUTO = `
insert into public.academie_reprises (user_id, module_id, section_id, portee, mode, par, verrou, deja_vues, pourcentage_skool)
values ($1::uuid, $2::uuid, $3::uuid, $4::text, 'auto', null, $5::text, 0, $6::smallint)
on conflict (user_id, verrou) where mode in ('membre', 'auto') do nothing
returning id::text as id
`

/**
 * Coche les lecons MANQUANTES : $1 compte, $2 lecons (uuid[]). Une lecon qui a
 * deja une ligne (vue, ouverte, cochee, decochee) n'est jamais touchee (do
 * nothing). Les memes marques que le bouton : vu_le, vu_par = 'reprise',
 * nb_sessions = 0 ; ni terminee_le ni marquee_vue_le. Seulement des lecons
 * publiees d'un module publie. Rend les lecons cochees.
 */
export const SQL_COCHER_REPRISE_AUTO = `
insert into public.academie_progression as p (user_id, lecon_id, derniere_vue_le, nb_sessions, vu_le, vu_par)
select $1::uuid, l.id, now(), 0, now(), 'reprise'
  from public.academie_lecons l
  join public.academie_modules m on m.id = l.module_id
 where l.id = any($2::uuid[]) and l.statut = 'publie' and m.statut = 'publie'
on conflict (user_id, lecon_id) do nothing
returning p.lecon_id::text as lecon_id
`

/** $1 = id de la reprise, $2 = lecons cochees (uuid[]), $3 = lecons visees laissees telles quelles. */
export const SQL_COMPLETER_REPRISE_AUTO = `
update public.academie_reprises set lecons = $2::uuid[], deja_vues = $3::int where id = $1::uuid
`

/** Ce qu'il faut d'un client Prisma (ou d'une transaction) pour ecrire. */
export type ExecutantSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

/**
 * Ecrit le pre-remplissage d'un compte (a appeler DANS une transaction) :
 * pour chaque item, la ligne du journal d'abord (l'index unique tient le
 * « une fois »), puis les lecons manquantes, puis la liste dans le journal.
 * Rend ce qui a ete fait.
 */
export async function ecrireRemplissage(tx: ExecutantSql, userId: string, items: readonly ItemRemplissage[]): Promise<{ cours: number; lecons: number }> {
  let cours = 0
  let lecons = 0
  for (const it of items) {
    const poses = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_POSER_REPRISE_AUTO,
      userId, it.moduleId, it.sectionId, it.portee, it.verrou, it.pourcentage)
    if (!poses[0]) continue
    const cochees = await tx.$queryRawUnsafe<{ lecon_id: string }[]>(SQL_COCHER_REPRISE_AUTO, userId, it.lecons)
    const ids = cochees.map(c => c.lecon_id)
    await tx.$executeRawUnsafe(SQL_COMPLETER_REPRISE_AUTO, poses[0].id, ids, it.lecons.length - ids.length)
    cours++
    lecons += ids.length
  }
  return { cours, lecons }
}
