// Le Live Club d'un compte du site, par TOUS ses emails connus (27/11/2026,
// correctif des bonus membres). Regles pures, sans base ni reseau : testees
// par scripts/verifier-bonus-membres.mjs. La lecture est dans compte.ts.
//
// Pourquoi (audit du 27/11, trous 1 a 4) : le Carnet et Pilotage Premium ne
// lisaient que la vue du cockpit (nourrie chaque matin), et l'academie ne
// cherchait l'abonnement chez Stripe que par les emails VERIFIES du compte.
// Un membre qui paie avec l'email A et se connecte avec l'email B n'etait
// donc pas reconnu, ou seulement le lendemain.
//
// Les emails connus, dans l'ordre : ceux verifies du compte (auth.users
// confirme, profile_emails verifie), puis ceux de sa fiche du cockpit
// (cockpit_membre_emails du membre relie a l'un d'eux), puis ceux de ses
// rattachements Live Club actifs. Ce sont des liens poses par nous (la
// collecte, le bot, l'equipe), JAMAIS un email saisi par l'acheteur.

import { normaliserEmail } from './pur'

/** Au plus 10 emails et 5 clients Stripe interroges par compte (chaque email coute 2 appels Stripe, en cache ensuite). */
export const MAX_EMAILS_COMPTE = 10
export const MAX_CLIENTS_COMPTE = 5

const ID_CLIENT = /^cus_[A-Za-z0-9]{8,}$/

/**
 * Les emails a interroger, sans doublon, normalises, dans l'ordre de
 * confiance : verifies, fiche, rattachements. Un email illisible est ecarte.
 */
export function emailsDuCompte(
  o: {
    verifies: readonly (string | null | undefined)[]
    fiche?: readonly (string | null | undefined)[] | null
    rattachements?: readonly (string | null | undefined)[] | null
  },
  max: number = MAX_EMAILS_COMPTE,
): string[] {
  const vus = new Set<string>()
  for (const brut of [...o.verifies, ...(o.fiche ?? []), ...(o.rattachements ?? [])]) {
    const e = normaliserEmail(brut)
    if (e) vus.add(e)
    if (vus.size >= max) break
  }
  return [...vus]
}

/** Les clients Stripe (cus_) des rattachements, sans doublon ni valeur illisible. */
export function clientsDuCompte(clients: readonly (string | null | undefined)[], max: number = MAX_CLIENTS_COMPTE): string[] {
  const vus = new Set<string>()
  for (const c of clients) {
    const propre = typeof c === 'string' ? c.trim() : ''
    if (ID_CLIENT.test(propre)) vus.add(propre)
    if (vus.size >= max) break
  }
  return [...vus]
}

export type EtatLu = 'oui' | 'non' | 'inconnu'

/**
 * Ce qu'une lecture Stripe (un email ou un client) dit : 'oui' si un
 * abonnement ouvre le Live Club (meilleurAbonnement : trialing compris,
 * plusieurs abonnements, fin payee), sinon 'non', sauf si la liste des
 * produits Live Club est incomplete (un produit inscrit depuis a pu etre
 * ignore : 'inconnu', comme droitLiveClub).
 */
export function etatDesAbonnements(meilleurTrouve: boolean, produitsComplets: boolean): EtatLu {
  if (meilleurTrouve) return 'oui'
  return produitsComplets ? 'non' : 'inconnu'
}

/** D'ou vient le 'oui' : une source sans Stripe, le filet du cockpit, ou un abonnement lu chez Stripe. */
export type SourceCompte = 'exemption' | 'broker' | 'manuel' | 'cockpit' | 'abonnement'

export type LiveClubCompte = { statut: EtatLu; source: SourceCompte | null }

/**
 * La conclusion, dans l'ordre :
 * 1. une source sans Stripe (exemption, acces broker, acces manuel) tranche ;
 * 2. le filet du cockpit (cockpit_abonnements actif ou en essai, sans impaye
 *    ni pause, non echu, relie a la fiche) : 'oui' sans appeler Stripe ;
 * 3. un abonnement lu chez Stripe par un email ou un client : 'oui' ;
 * 4. une lecture manquee (Stripe en delai ou en erreur, emails connus
 *    illisibles) : 'inconnu', jamais un faux 'non' ;
 * 5. sinon 'non'.
 */
export function conclureLiveClubCompte(o: {
  sansStripe: 'exemption' | 'broker' | 'manuel' | null
  filetCockpit: boolean
  stripe: readonly EtatLu[]
  lectureIncomplete?: boolean
}): LiveClubCompte {
  if (o.sansStripe) return { statut: 'oui', source: o.sansStripe }
  if (o.filetCockpit) return { statut: 'oui', source: 'cockpit' }
  if (o.stripe.includes('oui')) return { statut: 'oui', source: 'abonnement' }
  if (o.lectureIncomplete || o.stripe.includes('inconnu')) return { statut: 'inconnu', source: null }
  return { statut: 'non', source: null }
}

/**
 * Le Carnet et Pilotage Premium par le Live Club (checkMentoratAccess) : la
 * vue du cockpit (abonnement_en_cours, le filet d'avant) OU le Live Club lu
 * en direct. L'une ou l'autre suffit : on ne retire jamais un Premium que la
 * vue donnait. 'inconnu' en direct (Stripe lent) : la vue seule decide.
 */
export const premiumParLiveClub = (o: { vue: boolean | null | undefined; direct: EtatLu | null }): boolean =>
  o.vue === true || o.direct === 'oui'

/** Duree du cache par compte du Live Club en direct (checkMentoratAccess) : 'oui' 10 min, 'non' 1 min, 'inconnu' jamais. */
export function dureeCacheCompte(statut: EtatLu): number {
  if (statut === 'oui') return 10 * 60 * 1000
  if (statut === 'non') return 60 * 1000
  return 0
}

export class DelaiDepasse extends Error {
  constructor() {
    super('delai depasse')
    this.name = 'DelaiDepasse'
  }
}

/** La promesse, ou une DelaiDepasse au bout de ms. L'appel continue en fond, sans effet. */
export function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined
  const delai = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new DelaiDepasse()), ms)
  })
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuteur))
}
