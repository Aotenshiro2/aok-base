// Le prix d'une offre pour un membre du Live Club, sans reseau ni base
// (20/11/2026). Testable seul (scripts/verifier-partie2-membres-bf.mjs).
//
// Decision de Brice (choix du call du 17/11, go du 20/11) : pendant le Black
// Friday seulement (vendredi 27/11/2026 0 h au lundi 30/11/2026 23:59:59,
// heure de Paris), un membre du Live Club paie la partie 2 de Smart Money
// Technique 250 EUR au lieu de 850. Tous les autres paient le prix courant.
//
// Qui est membre (27/11/2026, Brice) : le Live Club actif, mais aussi un
// compte qui a achete la formation longue (formation-complete, le 10% Club)
// ou qui est ou a ete ETM (membreDuTarif, membreHorsLiveClub). Scripts :
// verifier-prix-membre-profils.mjs, verifier-modules-membres-bf.mjs.
//
// C'est le SEUL endroit qui calcule le prix d'un membre (prixMembre) : la
// carte (/api/academie/achat), le PayPal (commande et capture) et /moi
// (l'affichage) passent tous par lui. Decision de Brice du 20/11, PAS
// construite ici : plus tard, le prix courant de la partie 2 pour un membre
// baissera de ce qu'il a deja paye au Live Club, sans plancher. Elle se
// branchera dans prixMembre (une entree de plus, « dejaPayeEur »).
//
// Un tarif membre est une offre en base (SQL_TARIFS_MEMBRES) : son prix, son
// stripe_price_id et sa fenetre de vente. Rien n'est ecrit en dur ici.

import type { Droits, EtatLiveClub } from './pur'

export type TarifMembre = {
  /** L'offre vendue (academie_offres.slug), celle que l'achat ouvre : module-la-formation-complete-partie-2. */
  cible: string
  /** Le module de l'offre vendue (academie_offre_contenus), ou null si elle n'ouvre rien. */
  moduleId: string | null
  /** L'offre du tarif : module-la-formation-complete-partie-2-membres-bf. */
  slug: string
  prixEur: number
  stripePriceId: string
  debut: Date
  fin: Date
}

/** Une ligne de SQL_TARIFS_MEMBRES, ou null si elle est illisible (jamais un tarif a moitie lu). */
export function lireTarif(l: Record<string, unknown>): TarifMembre | null {
  const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const date = (v: unknown) => {
    const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null
    return d && !Number.isNaN(d.getTime()) ? d : null
  }
  const cible = texte(l.cible)
  const slug = texte(l.slug)
  const prix = typeof l.prix_eur === 'number' ? l.prix_eur : Number(l.prix_eur)
  const price = texte(l.stripe_price_id)
  const debut = date(l.vente_debut)
  const fin = date(l.vente_fin)
  if (!cible || !slug || !slug.startsWith(`${cible}-membres-`)) return null
  if (!Number.isFinite(prix) || !(prix > 0) || !price || !/^price_[A-Za-z0-9]+$/.test(price)) return null
  if (!debut || !fin || fin.getTime() <= debut.getTime()) return null
  return { cible, moduleId: texte(l.module_id), slug, prixEur: prix, stripePriceId: price, debut, fin }
}

/** Le tarif vaut-il a ce moment ? Bornes comprises (la fin est la derniere seconde de la fenetre). */
export const tarifEnCours = (t: Pick<TarifMembre, 'debut' | 'fin'>, quand: Date): boolean =>
  quand.getTime() >= t.debut.getTime() && quand.getTime() <= t.fin.getTime()

/**
 * Le compte est-il membre du Live Club POUR ce module ? La regle du site,
 * telle qu'elle existe : le Live Club lui ouvre une partie du module (la
 * partie 1 de Smart Money Technique, offre live-club de la base, ou un acces
 * de source liveclub), et son Live Club est actif (droits.liveClub 'oui' ;
 * l'equipe l'a toujours). 'inconnu' (Stripe illisible) ou 'non' : pas membre,
 * il paie le prix courant. Un achat de la partie 1 seule ne fait pas un membre.
 */
export function membreDuModule(d: Pick<Droits, 'liveClub' | 'ouvertures'>, moduleId: string | null): boolean {
  if (!moduleId || d.liveClub !== 'oui') return false
  return d.ouvertures.some(o => o.raison === 'liveclub' && o.siLiveClub && !o.cible.tout && o.cible.moduleId === moduleId)
}

/** Une offre vendue qui est une PARTIE d'un module (« module-<module>-partie-<n> »), comme achat-pur.ts (offrePartie). */
const OFFRE_DE_PARTIE = /^module-[a-z0-9]+(?:-[a-z0-9]+)*-partie-[1-9][0-9]?$/

/** L'offre est-elle une partie de module (module-<module>-partie-<n>) ? */
export const estOffreDePartie = (offre: string): boolean => OFFRE_DE_PARTIE.test(offre)

/**
 * (27/11/2026, Brice : « -50 c'est membre liveclub » puis « ça vaut aussi pour
 * ceux qui auraient déjà pris la formation longue ou ceux qui ont été dans
 * ETM ») Les profils qui ont le tarif membre sans passer par le Live Club :
 * la formation longue achetee (offre formation-complete, le 10% Club, active
 * ou echue, jamais retiree) ou un statut ETM, actuel ou ancien. Lus en base
 * (SQL_ACCES et SQL_FAITS_COCKPIT), jamais par Stripe : jamais 'inconnu'.
 * Champs absents (droits construits a la main) : faux.
 */
export const membreHorsLiveClub = (d: Partial<Pick<Droits, 'etm' | 'formationLongue' | 'aEteEtm'>>): boolean =>
  d.formationLongue === true || d.aEteEtm === true || d.etm === true

/**
 * (20/11/2026, modules au Black Friday) Qui a droit au tarif membre d'une
 * offre, une regle par tarif selon l'offre vendue :
 * - une PARTIE d'un module (la partie 2 de Smart Money Technique) : la regle
 *   de la partie 2 (membreDuModule : le Live Club ouvre une partie de ce
 *   module, et il est actif), OU (27/11) formation longue ou ETM ;
 * - un module ENTIER (les 7 modules vendus a l'unite) : le Live Club actif
 *   (droits.liveClub 'oui' ; l'equipe l'a toujours), OU (27/11) formation
 *   longue ou ETM (membreHorsLiveClub).
 * 'inconnu' (Stripe illisible), 'non' ou 'non_lu' sans formation ni ETM : pas
 * membre, prix courant. Un achat de la partie 1 seule (ou d'un module) ne
 * fait toujours pas un membre.
 */
export function membreDuTarif(
  d: Pick<Droits, 'liveClub' | 'ouvertures'> & Partial<Pick<Droits, 'etm' | 'formationLongue' | 'aEteEtm'>>,
  offre: string,
  moduleId: string | null,
): boolean {
  if (membreHorsLiveClub(d)) return true
  if (OFFRE_DE_PARTIE.test(offre)) return membreDuModule(d, moduleId)
  return d.liveClub === 'oui'
}

export type PrixCalcule = {
  /** Ce que le serveur facture. */
  prixEur: number
  /** Le prix courant de l'offre (850), barre par la page quand un tarif s'applique. */
  prixCourantEur: number
  /** Le tarif membre applique, ou null (prix courant). */
  tarif: TarifMembre | null
}

/**
 * LE calcul du prix d'une offre pour un compte. offre = l'offre vendue
 * (module-la-formation-complete-partie-2), prixCourantEur = son prix en base,
 * membre = membreDuModule, tarifs = SQL_TARIFS_MEMBRES lus (tous), quand = le
 * moment qui compte (maintenant, ou la creation de la commande PayPal a sa
 * capture). Non membre, hors fenetre, ou tarif pas plus bas : le prix courant.
 * Plusieurs tarifs en cours : le plus bas.
 */
export function prixMembre(p: {
  offre: string
  prixCourantEur: number
  membre: boolean
  tarifs: readonly TarifMembre[]
  quand: Date
}): PrixCalcule {
  const courant = { prixEur: p.prixCourantEur, prixCourantEur: p.prixCourantEur, tarif: null }
  if (!p.membre || !(p.prixCourantEur > 0)) return courant
  let meilleur: TarifMembre | null = null
  for (const t of p.tarifs) {
    if (t.cible !== p.offre || !tarifEnCours(t, p.quand) || !(t.prixEur < p.prixCourantEur)) continue
    if (!meilleur || t.prixEur < meilleur.prixEur) meilleur = t
  }
  return meilleur ? { prixEur: meilleur.prixEur, prixCourantEur: p.prixCourantEur, tarif: meilleur } : courant
}

/** Un tarif de cette offre pourrait-il valoir a ce moment (avant de lire les droits du compte, plus couteux) ? */
export const tarifPossible = (offre: string, tarifs: readonly TarifMembre[], quand: Date): boolean =>
  tarifs.some(t => t.cible === offre && tarifEnCours(t, quand))

/**
 * L'expiration de la session Checkout d'un tarif (expires_at, secondes) : une
 * session ouverte a 23 h 50 ne doit pas se payer a 250 EUR le lendemain
 * (24 h par defaut chez Stripe). Stripe exige 30 minutes au moins : la
 * session expire a la fin de la fenetre, ou 31 minutes apres sa creation si
 * la fin est plus proche. null : la fin est a plus de 24 h, rien a poser.
 */
export function expirationSession(fin: Date, maintenant: Date): number | null {
  const s = (d: number) => Math.floor(d / 1000)
  if (fin.getTime() - maintenant.getTime() >= 24 * 3600 * 1000) return null
  return Math.max(s(fin.getTime()), s(maintenant.getTime()) + 31 * 60)
}

/** Ce que /moi rend d'un tarif applique, pour la page du module : le prix, le prix barre et la fin. */
export const vueTarif = (c: PrixCalcule) =>
  c.tarif ? { prix_eur: c.prixEur, prix_courant_eur: c.prixCourantEur, fin_le: c.tarif.fin.toISOString() } : null

/**
 * (27/11/2026, correctif des bonus membres, trou 3) Plus jamais le prix plein
 * en silence : quand un tarif membre vaut mais que le statut du compte n'a
 * pas pu etre lu (Stripe lent ou illisible, apres le filet du cockpit, le
 * broker et l'acces manuel), ou que les droits du compte n'ont pas pu etre
 * lus du tout (prixDuCompte rend alors incertain), on ne lance PAS l'achat.
 * La route repond 503 'membre_inconnu' avec ce message, et la page propose
 * de reessayer. Un tarif applique, ou un non membre lu sans erreur : on vend.
 */
export function achatAVerifier(calcul: { tarif: TarifMembre | null; incertain: boolean }): boolean {
  return !calcul.tarif && calcul.incertain
}

/**
 * (28/11/2026, Brice : « quand on vend SMT de l'extérieur, on le vend full. On
 * ne le vend pas en deux parties. [...] Partie 1, partie 2, ça c'est que pour
 * les membres du Live Club. ») Une offre de PARTIE d'un module (OFFRE_DE_PARTIE :
 * module-la-formation-complete-partie-1 et -partie-2) ne se vend qu'a un compte
 * connecte dont le Live Club est actif (droits.liveClub 'oui' ; l'equipe l'a
 * toujours). Sans compte, 'non' ou 'non_lu' : 'reservee' (403
 * partie_reservee_membres). 'inconnu' (Stripe illisible) : 'inconnu' (503
 * membre_inconnu, reessayer). Le module entier et les autres offres : 'ok'.
 * La formation longue ou l'ETM seuls n'ouvrent PAS la vente d'une partie.
 */
export function ventePartie(p: { offre: string; connecte: boolean; liveClub: EtatLiveClub | null }): 'ok' | 'reservee' | 'inconnu' {
  if (!OFFRE_DE_PARTIE.test(p.offre)) return 'ok'
  if (!p.connecte) return 'reservee'
  if (p.liveClub === 'oui') return 'ok'
  return p.liveClub === 'inconnu' ? 'inconnu' : 'reservee'
}

export const ERREUR_PARTIE_RESERVEE = 'partie_reservee_membres'
export const TEXTE_PARTIE_RESERVEE =
  "Cette partie est réservée aux membres du Live Club : connecte-toi avec l'email de ton abonnement. Sinon, le module se prend en entier."

export const ERREUR_MEMBRE_INCONNU = 'membre_inconnu'
export const TEXTE_MEMBRE_INCONNU = "On n'a pas pu vérifier ton statut de membre. Réessaie dans un instant."
