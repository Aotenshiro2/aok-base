// LE CHANGEMENT DE FORMULE DU LIVE CLUB (Brice, 27/11/2026, GO « Go
// maintenant » dans le chat de l'Orchestre Prix). Module PUR : aucune base,
// aucun reseau. scripts/verifier-changement-formule.mjs le teste avec Node seul.
//
// Sur une demande claire du membre, l'agent propose (proposer_changement_formule,
// proposer_annuler_changement), le membre recoit un bouton, et c'est son clic
// qui execute (actions-membre.ts, puis stripe.ts). Regles decidees :
// 1. Forfait de 3 mois vers mensuel : le forfait va au bout de sa periode deja
//    payee (essai compris : trial_end pose par le passage de 8 h), puis
//    l'abonnement passe au mensuel a 99 EUR (PRIX_MENSUEL_LIVECLUB). Un
//    calendrier Stripe cree depuis l'abonnement (from_subscription), deux
//    phases : la phase en cours jusqu'a la date d'effet, puis le mensuel
//    (iterations 1, proration none), end_behavior release. Meme abonnement,
//    meme id : le bot reconnait toujours le membre. Ni remboursement, ni
//    prorata, ni double prelevement, aucun jour perdu.
// 2. Mensuel vers forfait de 3 mois : prevu mais COUPE tant que
//    PRIX_FORFAIT_3_MOIS_CIBLE est null (le seul prix de 3 mois actif est celui
//    d'Adil, on ne s'en sert jamais ; le 267 EUR est archive). Le membre recoit
//    ce qui existe deja : le lien direct jusqu'au 30/11 23 h 59, puis la page
//    live-club ou l'equipe.
// 3. Annuler un changement prevu tant que la date d'effet n'est pas atteinte :
//    le calendrier est relache (release), la formule reste la meme.
// 5. Refus : plusieurs lignes, calendrier qui n'est pas le notre, pause posee
//    ou prevue, arret programme (annuler l'arret d'abord), impaye, ETM,
//    deja dans la formule demandee.
// 6. Pause ou arret pendant un changement prevu : refuses, on propose
//    d'annuler d'abord le changement (Stripe refuse cancel_at_period_end sur un
//    abonnement pilote par un calendrier). Apres la date d'effet, le calendrier
//    est relache avant la pause ou l'arret (stripe.ts) : rien ne change pour le
//    membre, il est deja au mensuel.

import {
  CHANGEMENT_PAR_BOT, META_CHANGEMENT_DEMANDE, META_CHANGEMENT_EFFET, META_CHANGEMENT_PAR,
  META_CHANGEMENT_SCHEDULE, META_CHANGEMENT_SENS, SENS_CHANGEMENT, formaterDateFr,
  type EtatFormule, type VersFormule,
} from './pur'

export type { EtatFormule, VersFormule }

/** Le mensuel du Live Club, 99 EUR par mois (produit prod_UcOraPncQlbrW4, compte Stripe de Melanie). */
export const PRIX_MENSUEL_LIVECLUB = 'price_1TdA3RCbHiN0O0XixdHcppnE'
export const TEXTE_PRIX_MENSUEL = '99 € par mois'

/**
 * Le prix du forfait de 3 mois CIBLE du sens montant (mensuel vers forfait).
 * null aujourd'hui : l'outil refuse ce sens. Jamais le prix d'Adil
 * (price_1UeGf4CbHiN0O0Xi0vQFXXQy), jamais le 267 EUR archive
 * (price_1UdsPkCbHiN0O0XiPgpXJIIt). Le jour ou un prix est pose ici, la meme
 * mecanique s'applique dans l'autre sens.
 */
export const PRIX_FORFAIT_3_MOIS_CIBLE: string | null = null
/** Le montant a dire sur le bouton du sens montant, avec le prix ci-dessus (ex. « 267 € les 3 mois »). */
export const TEXTE_PRIX_FORFAIT_3_MOIS: string | null = null

/** Le tarif symbolique de l'ETM : jamais touche. */
export const PRODUIT_ETM = 'prod_VR1P7PggEH30B9'

/**
 * Ce qui existe deja pour passer au forfait (fiche live-club,
 * docs/connaissances/live-club.md) : le lien de paiement direct jusqu'au
 * lundi 30/11 a 23 h 59 (heure de Paris), puis la page du Live Club.
 * verifier-changement-formule.mjs controle que la fiche donne le meme lien.
 */
export const LIEN_DIRECT_FORFAIT = 'https://buy.stripe.com/00w00i6cC4Vc3rnetkbsc0d'
export const FIN_LIEN_DIRECT_FORFAIT_MS = Date.parse('2026-11-30T23:00:00Z')
export const PAGE_LIVE_CLUB = 'https://aoknowledge.com/live-club'

const NOM_FORMULE: Readonly<Record<VersFormule, string>> = { mensuel: 'au mois', forfait_3_mois: 'au forfait de 3 mois' }
const EQUIPE = "Si tu veux, je préviens l'équipe : elle te répond ici."

export type MotifRefusChangement =
  | 'vers_invalide' | 'etm' | 'statut' | 'impaye' | 'plusieurs_lignes' | 'formule_inconnue'
  | 'deja_dans_la_formule' | 'deja_prevu' | 'sens_coupe' | 'calendrier_etranger'
  | 'pause' | 'arret_programme' | 'fin_inconnue'

export type DecisionChangement =
  | { ok: true; vers: VersFormule; prixCible: string; effetSec: number }
  | { ok: false; motif: MotifRefusChangement; raison: string }

export function versFormuleValide(v: unknown): v is VersFormule {
  return v === 'mensuel' || v === 'forfait_3_mois'
}

/** La date d'effet : la fin de la periode payee, essai compris (le plus tard des deux). */
export function dateEffetChangement(e: Pick<EtatFormule, 'finPeriodeSec' | 'trialEndSec'>): number | null {
  const d = Math.max(e.finPeriodeSec ?? 0, e.trialEndSec ?? 0)
  return d > 0 ? d : null
}

function dateFr(sec: number): string {
  return formaterDateFr(new Date(sec * 1000).toISOString())
}

/** Le sens montant coupe : ce qui existe deja, selon la date. */
export function texteSensMontantCoupe(maintenantMs: number): string {
  const deuxFois = "Tu ne paies pas deux fois : ton mensuel s'arrête tout seul à la fin du mois déjà payé, et les jours restants s'ajoutent à ton forfait, si tu paies avec le même email que ton abonnement. Avec une autre adresse, dis-le-moi, je passe la main à l'équipe."
  if (maintenantMs < FIN_LIEN_DIRECT_FORFAIT_MS) {
    return `Pour passer au forfait de 3 mois, tu le prends directement avec ce lien, valable jusqu'au lundi 30 novembre à 23 h 59 :\n${LIEN_DIRECT_FORFAIT}\n\n${deuxFois}`
  }
  return `Pour passer au forfait de 3 mois, regarde la page du Live Club :\n${PAGE_LIVE_CLUB}\n\n${deuxFois} ${EQUIPE}`
}

/**
 * La regle du changement de formule, sur l'abonnement vivant du membre. Ne
 * dit rien de Stripe : stripe.ts relit l'abonnement et rejoue cette regle
 * juste avant d'ecrire.
 */
export function decisionChangement(
  e: EtatFormule,
  vers: unknown,
  o: { maintenantMs: number; prixForfait?: string | null },
): DecisionChangement {
  const refus = (motif: MotifRefusChangement, raison: string): DecisionChangement => ({ ok: false, motif, raison })
  if (!versFormuleValide(vers)) return refus('vers_invalide', 'Dis-moi vers quelle formule : au mois, ou au forfait de 3 mois.')
  if (e.produits.includes(PRODUIT_ETM)) {
    return refus('etm', `Ton abonnement est à un tarif particulier : je ne change pas sa formule moi-même. ${EQUIPE}`)
  }
  if (e.statut === 'past_due' || e.statut === 'unpaid') {
    return refus('impaye', `Ton dernier paiement n'est pas passé, donc je ne peux pas changer ta formule pour l'instant. ${EQUIPE}`)
  }
  if (e.statut !== 'active' && e.statut !== 'trialing') {
    return refus('statut', `Je ne trouve pas d'abonnement Live Club en cours à ton nom, donc rien à changer.`)
  }
  if (e.nbLignes !== 1) {
    return refus('plusieurs_lignes', `Ton abonnement a plusieurs lignes, donc je ne change pas sa formule moi-même. ${EQUIPE}`)
  }
  if (e.formule === 'autre') {
    return refus('formule_inconnue', `Ton abonnement n'est ni au mois ni au forfait de 3 mois, donc je ne change pas sa formule moi-même. ${EQUIPE}`)
  }
  const c = e.changement
  if (c && c.effetSec * 1000 > o.maintenantMs) {
    if (c.vers === vers) return refus('deja_prevu', `Ton passage ${NOM_FORMULE[vers]} est déjà prévu le ${dateFr(c.effetSec)}, rien de plus à faire.`)
    return refus('deja_dans_la_formule', `Tu es ${NOM_FORMULE[vers]}, et ton passage ${NOM_FORMULE[c.vers]} est prévu le ${dateFr(c.effetSec)}. Si tu préfères rester ${NOM_FORMULE[vers]}, je peux annuler ce changement.`)
  }
  if (e.formule === vers) return refus('deja_dans_la_formule', `Tu es déjà ${NOM_FORMULE[vers]}, rien à changer.`)
  const prixForfait = o.prixForfait === undefined ? PRIX_FORFAIT_3_MOIS_CIBLE : o.prixForfait
  if (vers === 'forfait_3_mois' && !prixForfait) return refus('sens_coupe', texteSensMontantCoupe(o.maintenantMs))
  if (e.schedule && !c) {
    return refus('calendrier_etranger', `Un changement est déjà prévu sur ton abonnement, donc je n'y touche pas. ${EQUIPE}`)
  }
  if (e.pauseActive) {
    return refus('pause', `Une pause est posée ou prévue sur ton abonnement, donc je ne change pas sa formule en même temps. ${EQUIPE}`)
  }
  const effet = dateEffetChangement(e)
  if (e.arretPrevu) {
    return refus('arret_programme', `Ton abonnement s'arrête${effet ? ` le ${dateFr(effet)}` : ' à la fin de ta période'}. Pour changer de formule, il faut d'abord annuler cet arrêt : je peux le faire si tu me le demandes.`)
  }
  if (!effet || effet * 1000 <= o.maintenantMs) {
    return refus('fin_inconnue', `Je n'arrive pas à lire la fin de ta période payée, donc je ne change rien. Réessaie dans un moment. ${EQUIPE}`)
  }
  return { ok: true, vers, prixCible: vers === 'mensuel' ? PRIX_MENSUEL_LIVECLUB : prixForfait as string, effetSec: effet }
}

export type DecisionAnnulation =
  | { ok: true; vers: VersFormule; effetSec: number; schedule: string }
  | { ok: false; motif: 'aucun' | 'deja_fait'; raison: string }

/** Annuler notre changement prevu, tant que sa date d'effet n'est pas atteinte. */
export function decisionAnnulationChangement(e: EtatFormule, maintenantMs: number): DecisionAnnulation {
  const c = e.changement
  if (!c) return { ok: false, motif: 'aucun', raison: "Aucun changement de formule n'est prévu sur ton abonnement : il continue comme aujourd'hui." }
  if (c.effetSec * 1000 <= maintenantMs) {
    return { ok: false, motif: 'deja_fait', raison: `Le changement a déjà eu lieu le ${dateFr(c.effetSec)} : ton abonnement est maintenant ${NOM_FORMULE[c.vers]}. ${EQUIPE}` }
  }
  return { ok: true, vers: c.vers, effetSec: c.effetSec, schedule: c.schedule }
}

/**
 * Pause ou arret pendant un changement prevu (regle 6) : le texte du refus,
 * ou null si rien ne bloque (pas de changement, ou deja passe : stripe.ts
 * relache alors le calendrier avant d'agir).
 */
export function refusPendantChangement(e: EtatFormule, geste: 'pause' | 'arret', maintenantMs: number): string | null {
  const c = e.changement
  if (!c || c.effetSec * 1000 <= maintenantMs) return null
  const quoi = geste === 'pause' ? 'une pause' : "l'arrêt"
  return `Ton passage ${NOM_FORMULE[c.vers]} est prévu le ${dateFr(c.effetSec)}. Pour ${quoi}, il faut d'abord annuler ce changement : je peux le faire si tu me le demandes, puis on regarde ${quoi}.`
}

// ---------------------------------------------------------------------------
// Les textes au membre
// ---------------------------------------------------------------------------

/** Le texte du bouton de confirmation : la date d'effet, et le prix pour le mensuel. */
export function texteConfirmationChangement(d: { vers: VersFormule; effetSec: number }, prixForfaitTexte: string | null = TEXTE_PRIX_FORFAIT_3_MOIS): string {
  const date = dateFr(d.effetSec)
  if (d.vers === 'mensuel') {
    return `Tu confirmes le passage au mois ?\n\n`
      + `Ton forfait de 3 mois va jusqu'au ${date} : tu gardes tout jusque-là, sans rien payer de plus. `
      + `Ensuite ton abonnement passe au mois, à ${TEXTE_PRIX_MENSUEL}, avec un premier prélèvement le ${date}. `
      + `Pas de double paiement, aucun jour perdu. Tu peux annuler ce changement jusqu'au ${date}.`
  }
  return `Tu confirmes le passage au forfait de 3 mois ?\n\n`
    + `Ton mois payé va jusqu'au ${date} : tu gardes tout jusque-là, sans rien payer de plus. `
    + `Ensuite ton abonnement passe au forfait de 3 mois${prixForfaitTexte ? `, à ${prixForfaitTexte}` : ''}, avec un premier prélèvement le ${date}. `
    + `Pas de double paiement, aucun jour perdu. Tu peux annuler ce changement jusqu'au ${date}.`
}

export function texteChangementFait(d: { vers: VersFormule; effetSec: number }): string {
  const date = dateFr(d.effetSec)
  const suite = d.vers === 'mensuel' ? `passe au mois, à ${TEXTE_PRIX_MENSUEL}` : 'passe au forfait de 3 mois'
  const avant = d.vers === 'mensuel' ? 'Ton forfait de 3 mois' : 'Ton mois payé'
  return `C'est fait. ${avant} va jusqu'au ${date}, puis ton abonnement ${suite}.\n\n`
    + `Si tu changes d'avis avant cette date, écris-moi, je peux annuler ce changement.`
}

export function texteConfirmationAnnulation(d: { vers: VersFormule; effetSec: number }): string {
  const reste = d.vers === 'mensuel' ? 'forfait de 3 mois' : 'mois'
  return `Tu confirmes que tu restes au ${reste} ?\n\n`
    + `Le passage ${NOM_FORMULE[d.vers]} prévu le ${dateFr(d.effetSec)} est annulé, et ton abonnement continue comme aujourd'hui.`
}

export function texteAnnulationFaite(d: { vers: VersFormule; effetSec: number }): string {
  const reste = d.vers === 'mensuel' ? 'forfait de 3 mois' : 'mois'
  return `C'est fait, le changement est annulé. Ton abonnement reste au ${reste}, prochain renouvellement le ${dateFr(d.effetSec)}.`
}

/** La phrase de « mon abonnement » quand un changement est prevu (regle 4), ou null. */
export function phraseChangementPrevu(e: EtatFormule | undefined, maintenantMs: number): string | null {
  const c = e?.changement
  if (!c || c.effetSec * 1000 <= maintenantMs) return null
  const avant = c.vers === 'mensuel' ? 'Ton forfait de 3 mois' : 'Ton mois payé'
  return `${avant} va jusqu'au ${dateFr(c.effetSec)}, puis ton abonnement passe ${NOM_FORMULE[c.vers]} : c'est le changement que tu as demandé. Tu peux encore l'annuler d'ici là.`
}

/** Les faits de l'agent sur un changement prevu, ou {}. */
export function faitsChangementPrevu(e: EtatFormule | undefined, maintenantMs: number): Record<string, unknown> {
  const c = e?.changement
  if (!c || c.effetSec * 1000 <= maintenantMs) return {}
  return { changement_formule_prevu: { vers: c.vers === 'mensuel' ? 'mensuel' : 'forfait de 3 mois', le: dateFr(c.effetSec), annulable: true } }
}

/**
 * (Regle 9) Le rappel de renouvellement d'un forfait (5 semaines puis 1
 * semaine avant l'echeance, pas encore code au 27/11) : un membre qui a
 * demande le passage au mois ne recoit JAMAIS l'annonce d'un renouvellement
 * du forfait. 'renouvellement' = le rappel habituel ; 'passage_au_mois' = le
 * texte juste ci-dessous a la place.
 */
export function rappelForfait(e: EtatFormule | undefined, maintenantMs: number): 'renouvellement' | 'passage_au_mois' {
  const c = e?.changement
  return c && c.vers === 'mensuel' && c.effetSec * 1000 > maintenantMs ? 'passage_au_mois' : 'renouvellement'
}

export function texteRappelPassageAuMois(effetSec: number): string {
  return `Ton forfait de 3 mois se termine le ${dateFr(effetSec)}. Ensuite, ton abonnement passe au mois, à ${TEXTE_PRIX_MENSUEL}, comme tu l'as demandé.`
}

// ---------------------------------------------------------------------------
// Le calendrier Stripe (corps des appels, sans reseau)
// ---------------------------------------------------------------------------

/** Les metadonnees posees sur l'abonnement et sur le calendrier (regle 8). */
export function metadonneesChangement(d: { vers: VersFormule; effetSec: number }, schedule: string, demandeLe: Date): Record<string, string> {
  return {
    [META_CHANGEMENT_PAR]: CHANGEMENT_PAR_BOT,
    [META_CHANGEMENT_SENS]: SENS_CHANGEMENT[d.vers],
    [META_CHANGEMENT_DEMANDE]: demandeLe.toISOString(),
    [META_CHANGEMENT_EFFET]: new Date(d.effetSec * 1000).toISOString(),
    [META_CHANGEMENT_SCHEDULE]: schedule,
  }
}

/** Efface nos metadonnees (une valeur vide efface la cle chez Stripe), apres une annulation. */
export function effacementMetadonneesChangement(): Record<string, string> {
  const corps: Record<string, string> = {}
  for (const k of [META_CHANGEMENT_PAR, META_CHANGEMENT_SENS, META_CHANGEMENT_DEMANDE, META_CHANGEMENT_EFFET, META_CHANGEMENT_SCHEDULE]) corps[`metadata[${k}]`] = ''
  return corps
}

type PhaseBrute = Record<string, unknown>

function chaine(x: unknown): string | null {
  if (typeof x === 'string' && x) return x
  const id = (x as { id?: unknown } | null | undefined)?.id
  return typeof id === 'string' && id ? id : null
}

/**
 * La phase en cours rendue par from_subscription correspond-elle a la date
 * d'effet calculee ? Sinon on ne pose rien (stripe.ts relache le calendrier) :
 * jamais une date annoncee au membre qui ne serait pas celle de Stripe.
 */
export function phaseCouranteConforme(phase: PhaseBrute | undefined, effetSec: number): boolean {
  return Boolean(phase) && phase!.end_date === effetSec && typeof phase!.start_date === 'number'
}

/**
 * Le corps de POST /v1/subscription_schedules/{id} : la phase en cours
 * recopiee (lignes, essai, remises, moyen de paiement, taxes, metadonnees :
 * Stripe efface ce qui n'est pas repasse) jusqu'a la date d'effet, puis le
 * prix cible pour une periode (iterations 1, comme mel_forfaits_renouvellement.py),
 * sans prorata, et release a la fin : l'abonnement continue seul au nouveau prix.
 */
export function corpsCalendrierChangement(
  phase: PhaseBrute,
  d: { effetSec: number; prixCible: string },
  meta: Record<string, string>,
): Record<string, string> {
  const corps: Record<string, string> = {
    end_behavior: 'release',
    proration_behavior: 'none',
    'phases[0][start_date]': String(phase.start_date),
    'phases[0][end_date]': String(d.effetSec),
    'phases[1][items][0][price]': d.prixCible,
    'phases[1][items][0][quantity]': '1',
    'phases[1][iterations]': '1',
    'phases[1][proration_behavior]': 'none',
  }
  const items = Array.isArray(phase.items) ? phase.items as Record<string, unknown>[] : []
  items.forEach((it, i) => {
    const prix = chaine(it.price)
    if (prix) corps[`phases[0][items][${i}][price]`] = prix
    corps[`phases[0][items][${i}][quantity]`] = String(typeof it.quantity === 'number' ? it.quantity : 1)
    const taux = Array.isArray(it.tax_rates) ? it.tax_rates.map(chaine).filter((t): t is string => Boolean(t)) : []
    taux.forEach((t, j) => { corps[`phases[0][items][${i}][tax_rates][${j}]`] = t })
  })
  if (typeof phase.trial_end === 'number') corps['phases[0][trial_end]'] = String(phase.trial_end)
  const remises = Array.isArray(phase.discounts) ? phase.discounts as Record<string, unknown>[] : []
  remises.forEach((r, i) => {
    for (const k of ['coupon', 'discount', 'promotion_code']) {
      const v = chaine(r[k])
      if (v) corps[`phases[0][discounts][${i}][${k}]`] = v
    }
  })
  const pm = chaine(phase.default_payment_method)
  const collecte = typeof phase.collection_method === 'string' ? phase.collection_method : null
  const tauxDefaut = Array.isArray(phase.default_tax_rates) ? phase.default_tax_rates.map(chaine).filter((t): t is string => Boolean(t)) : []
  const taxeAuto = (phase.automatic_tax as { enabled?: unknown } | null | undefined)?.enabled === true
  for (const n of [0, 1]) {
    if (pm) corps[`phases[${n}][default_payment_method]`] = pm
    if (collecte) corps[`phases[${n}][collection_method]`] = collecte
    tauxDefaut.forEach((t, j) => { corps[`phases[${n}][default_tax_rates][${j}]`] = t })
    if (taxeAuto) corps[`phases[${n}][automatic_tax][enabled]`] = 'true'
  }
  const metaPhase = phase.metadata && typeof phase.metadata === 'object' ? phase.metadata as Record<string, unknown> : {}
  for (const [k, v] of Object.entries(metaPhase)) if (typeof v === 'string') corps[`phases[0][metadata][${k}]`] = v
  for (const [k, v] of Object.entries(meta)) corps[`metadata[${k}]`] = v
  return corps
}
