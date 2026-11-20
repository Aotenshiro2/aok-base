// Le prix d'une offre pour un membre du Live Club, sans reseau ni base
// (20/11/2026). Testable seul (scripts/verifier-partie2-membres-bf.mjs).
//
// Decision de Brice (choix du call du 17/11, go du 20/11) : pendant le Black
// Friday seulement (vendredi 27/11/2026 0 h au lundi 30/11/2026 23:59:59,
// heure de Paris), un membre du Live Club paie la partie 2 de Smart Money
// Technique 250 EUR au lieu de 850. Tous les autres paient le prix courant.
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

import type { Droits } from './pur'

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
