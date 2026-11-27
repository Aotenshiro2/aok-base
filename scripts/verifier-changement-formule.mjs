// Tests du CHANGEMENT DE FORMULE du Live Club (27/11, Brice) :
// src/lib/liveclub/changement-formule-pur.ts et la lecture brute de pur.ts.
// - chaque refus (ETM, impaye, plusieurs lignes, calendrier etranger, pause,
//   arret programme, deja dans la formule, deja prevu, formule inconnue) ;
// - la date d'effet, essai compris (trial_end du passage de 8 h) ;
// - le sens montant coupe tant que PRIX_FORFAIT_3_MOIS_CIBLE est null ;
// - l'annulation, la pause et l'arret pendant un changement prevu ;
// - le corps du calendrier Stripe (aucun appel : objets fictifs) ;
// - le cablage de l'agent (outils, prompt, fiche live-club).
// Aucune base, aucun reseau, aucun appel Stripe ni au modele.
//   node scripts/verifier-changement-formule.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const C = await import('../src/lib/liveclub/changement-formule-pur.ts')
const P = await import('../src/lib/liveclub/pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const J = 86_400
const MAINTENANT = Date.parse('2026-11-27T12:00:00Z')
const MAINTENANT_SEC = MAINTENANT / 1000
const FIN = Date.parse('2027-02-27T10:00:00Z') / 1000

/** Un abonnement Stripe brut fictif. */
function abo(o = {}) {
  const lignes = o.lignes ?? [{ price: { id: 'price_forfait', product: o.produit ?? 'prod_UcOraPncQlbrW4', recurring: { interval: 'month', interval_count: o.mois ?? 3 } }, current_period_end: o.fin ?? FIN }]
  return {
    id: 'sub_test12345678', status: o.statut ?? 'active', customer: 'cus_test12345678',
    items: { data: lignes },
    cancel_at_period_end: o.arret === true,
    pause_collection: o.pause ?? null,
    trial_end: o.trial ?? null,
    schedule: o.schedule ?? null,
    metadata: o.meta ?? {},
  }
}
const etat = o => P.lireEtatFormule(abo(o), MAINTENANT)
const decide = (o, vers, x = {}) => C.decisionChangement(etat(o), vers, { maintenantMs: MAINTENANT, ...x })
const notreMeta = (vers, effetSec, schedule = 'sub_sched_ABC123') => ({
  [P.META_CHANGEMENT_PAR]: P.CHANGEMENT_PAR_BOT,
  [P.META_CHANGEMENT_SENS]: P.SENS_CHANGEMENT[vers],
  [P.META_CHANGEMENT_EFFET]: new Date(effetSec * 1000).toISOString(),
  [P.META_CHANGEMENT_SCHEDULE]: schedule,
  [P.META_CHANGEMENT_DEMANDE]: '2026-11-27T12:00:00.000Z',
})

await bloc('lecture brute : formule par la periode du prix, lignes, produits, essai, calendrier', () => {
  assert.equal(etat({}).formule, 'forfait_3_mois')
  assert.equal(etat({ mois: 1 }).formule, 'mensuel')
  assert.equal(etat({ mois: 6 }).formule, 'autre')
  assert.equal(P.formuleDuPrix({ interval: 'year', interval_count: 1 }), 'autre')
  assert.equal(P.formuleDuPrix({ interval: 'month' }), 'mensuel')
  const e = etat({ trial: FIN + 5 * J, schedule: { id: 'sub_sched_X' } })
  assert.equal(e.nbLignes, 1)
  assert.deepEqual(e.produits, ['prod_UcOraPncQlbrW4'])
  assert.equal(e.trialEndSec, FIN + 5 * J)
  assert.equal(e.schedule, 'sub_sched_X')
  assert.equal(e.changement, null, 'calendrier sans nos metadonnees : pas le notre')
})

await bloc('notre changement : nos metadonnees ET le meme calendrier attache ; des metadonnees restees ne comptent pas', () => {
  const meta = notreMeta('mensuel', FIN)
  const e = etat({ schedule: 'sub_sched_ABC123', meta })
  assert.deepEqual(e.changement, { vers: 'mensuel', effetSec: FIN, schedule: 'sub_sched_ABC123', demandeLe: '2026-11-27T12:00:00.000Z' })
  assert.equal(etat({ schedule: null, meta }).changement, null, 'calendrier relache : metadonnees perimees')
  assert.equal(etat({ schedule: 'sub_sched_AUTRE', meta }).changement, null, 'un autre calendrier')
  assert.equal(etat({ schedule: 'sub_sched_ABC123', meta: { ...meta, [P.META_CHANGEMENT_PAR]: 'quelquun' } }).changement, null)
  // resumerAbonnement pose la lecture, sans rien changer d'autre.
  const r = P.resumerAbonnement(abo({ schedule: 'sub_sched_ABC123', meta }), ['prod_UcOraPncQlbrW4'])
  assert.equal(r.formule.changement.vers, 'mensuel')
  assert.equal(r.periodicite, '3 mois')
})

await bloc('forfait de 3 mois vers mensuel : accepte, date d effet = fin de periode, prix 99 € par mois', () => {
  const d = decide({}, 'mensuel')
  assert.deepEqual(d, { ok: true, vers: 'mensuel', prixCible: 'price_1TdA3RCbHiN0O0XixdHcppnE', effetSec: FIN })
  assert.equal(C.PRIX_MENSUEL_LIVECLUB, 'price_1TdA3RCbHiN0O0XixdHcppnE')
  const t = C.texteConfirmationChangement(d)
  assert.match(t, /^Tu confirmes le passage au mois \?/)
  assert.ok(t.includes('27 février 2027'), 'date d effet')
  assert.ok(t.includes('99 € par mois'), 'le prix du mensuel sur le bouton')
  assert.ok(!/[—–*]/.test(t), 'ni tiret long ni markdown')
  assert.match(C.texteChangementFait(d), /^C'est fait\. Ton forfait de 3 mois va jusqu'au 27 février 2027, puis ton abonnement passe au mois, à 99 € par mois/)
})

await bloc('date d effet : essai compris (trial_end des jours reportes), jamais avant la fin de periode', () => {
  // Essai du passage de 8 h : Stripe met current_period_end = trial_end ; on prend le plus tard des deux.
  const d = decide({ statut: 'trialing', trial: FIN + 12 * J, fin: FIN + 12 * J }, 'mensuel')
  assert.equal(d.ok, true)
  assert.equal(d.effetSec, FIN + 12 * J)
  const d2 = decide({ statut: 'trialing', trial: FIN + 12 * J, fin: FIN }, 'mensuel')
  assert.equal(d2.effetSec, FIN + 12 * J, 'trial_end plus tard que la fin lue : trial_end')
  const d3 = decide({ trial: FIN - 30 * J }, 'mensuel')
  assert.equal(d3.effetSec, FIN, 'essai deja passe : la fin de periode')
  assert.equal(C.dateEffetChangement({ finPeriodeSec: null, trialEndSec: null }), null)
  assert.equal(decide({ fin: MAINTENANT_SEC - J }, 'mensuel').motif, 'fin_inconnue')
})

await bloc('chaque refus a sa phrase simple, et propose l equipe quand il faut', () => {
  const cas = [
    [{ produit: 'prod_VR1P7PggEH30B9' }, 'mensuel', 'etm', /tarif particulier.*préviens l'équipe/],
    [{ statut: 'past_due' }, 'mensuel', 'impaye', /dernier paiement n'est pas passé.*préviens l'équipe/],
    [{ statut: 'canceled' }, 'mensuel', 'statut', /rien à changer/],
    [{ lignes: [abo().items.data[0], abo().items.data[0]] }, 'mensuel', 'plusieurs_lignes', /plusieurs lignes.*préviens l'équipe/],
    [{ mois: 6 }, 'mensuel', 'formule_inconnue', /ni au mois ni au forfait.*préviens l'équipe/],
    [{ schedule: 'sub_sched_ADIL' }, 'mensuel', 'calendrier_etranger', /déjà prévu sur ton abonnement.*préviens l'équipe/],
    [{ pause: { behavior: 'void', resumes_at: FIN + 60 * J } }, 'mensuel', 'pause', /pause est posée ou prévue.*préviens l'équipe/],
    [{ pause: { behavior: 'void', resumes_at: null } }, 'mensuel', 'pause', /pause/],
    [{ arret: true }, 'mensuel', 'arret_programme', /s'arrête le 27 février 2027.*annuler cet arrêt : je peux le faire/],
    [{ mois: 1 }, 'mensuel', 'deja_dans_la_formule', /Tu es déjà au mois, rien à changer/],
    [{}, 'forfait_3_mois', 'deja_dans_la_formule', /Tu es déjà au forfait de 3 mois, rien à changer/],
    [{}, 'annuel', 'vers_invalide', /vers quelle formule/],
  ]
  for (const [o, vers, motif, re] of cas) {
    const d = decide(o, vers)
    assert.equal(d.ok, false, motif)
    assert.equal(d.motif, motif, `${motif} : ${d.motif}`)
    assert.match(d.raison, re, motif)
    assert.ok(!/[—–*]/.test(d.raison), `${motif} : ni tiret long ni markdown`)
  }
  // ETM : jamais touche, meme dans le sens coupe ou avec un prix cible.
  assert.equal(decide({ produit: 'prod_VR1P7PggEH30B9', mois: 1 }, 'forfait_3_mois', { prixForfait: 'price_x' }).motif, 'etm')
  // L'arret passe avant la pause ? Non : chaque cas seul ; un impaye passe avant le reste.
  assert.equal(decide({ statut: 'past_due', arret: true, schedule: 'sub_sched_X' }, 'mensuel').motif, 'impaye')
})

await bloc('changement deja prevu : redemande = deja prevu, sens inverse = proposer l annulation', () => {
  const o = { schedule: 'sub_sched_ABC123', meta: notreMeta('mensuel', FIN) }
  const d = decide(o, 'mensuel')
  assert.equal(d.motif, 'deja_prevu')
  assert.match(d.raison, /passage au mois est déjà prévu le 27 février 2027/)
  const d2 = decide(o, 'forfait_3_mois')
  assert.equal(d2.motif, 'deja_dans_la_formule')
  assert.match(d2.raison, /Tu es au forfait de 3 mois, et ton passage au mois est prévu le 27 février 2027\. Si tu préfères rester au forfait de 3 mois, je peux annuler ce changement\./)
  // Notre calendrier n'est pas un calendrier etranger.
  assert.notEqual(d.motif, 'calendrier_etranger')
})

await bloc('sens montant (mensuel vers forfait) COUPE tant que la constante est null : le lien jusqu au 30/11 23 h 59, puis la page', () => {
  assert.equal(C.PRIX_FORFAIT_3_MOIS_CIBLE, null)
  assert.equal(C.TEXTE_PRIX_FORFAIT_3_MOIS, null)
  const o = { mois: 1, fin: Date.parse('2026-12-15T09:00:00Z') / 1000 }
  const d = decide(o, 'forfait_3_mois')
  assert.equal(d.ok, false)
  assert.equal(d.motif, 'sens_coupe')
  assert.ok(d.raison.includes('https://buy.stripe.com/00w00i6cC4Vc3rnetkbsc0d\n'), 'lien seul sur sa ligne')
  assert.match(d.raison, /lundi 30 novembre à 23 h 59/)
  assert.match(d.raison, /ne paies pas deux fois.*fin du mois déjà payé.*jours restants s'ajoutent à ton forfait.*même email/)
  assert.ok(!d.raison.includes('99'), 'pas le prix du mensuel')
  // Le 30/11 a 23 h 59 de Paris : encore le lien ; le 01/12 a 0 h : la page.
  const avant = C.decisionChangement(etat(o), 'forfait_3_mois', { maintenantMs: Date.parse('2026-11-30T22:59:00Z') })
  assert.ok(avant.raison.includes('buy.stripe.com'))
  const apres = C.decisionChangement(etat(o), 'forfait_3_mois', { maintenantMs: Date.parse('2026-11-30T23:00:00Z') })
  assert.ok(!apres.raison.includes('buy.stripe.com'))
  assert.ok(apres.raison.includes('https://aoknowledge.com/live-club\n'))
  assert.match(apres.raison, /préviens l'équipe/)
  // Le jour ou un prix est pose : meme mecanique, a la fin du mois paye.
  const ok = decide(o, 'forfait_3_mois', { prixForfait: 'price_FORFAIT_TEST' })
  assert.deepEqual(ok, { ok: true, vers: 'forfait_3_mois', prixCible: 'price_FORFAIT_TEST', effetSec: o.fin })
  assert.match(C.texteConfirmationChangement(ok, '267 € les 3 mois'), /passe au forfait de 3 mois, à 267 € les 3 mois, avec un premier prélèvement le 15 décembre 2026/)
  // Jamais le prix d'Adil ni le 267 archive dans le code.
  const src = lire('../src/lib/liveclub/changement-formule-pur.ts')
  assert.match(src, /export const PRIX_FORFAIT_3_MOIS_CIBLE: string \| null = null/)
})

await bloc('annulation : rien de prevu, deja passe, ou a venir (bouton puis texte)', () => {
  const sans = C.decisionAnnulationChangement(etat({}), MAINTENANT)
  assert.equal(sans.ok, false)
  assert.equal(sans.motif, 'aucun')
  const prevu = etat({ schedule: 'sub_sched_ABC123', meta: notreMeta('mensuel', FIN) })
  const d = C.decisionAnnulationChangement(prevu, MAINTENANT)
  assert.deepEqual(d, { ok: true, vers: 'mensuel', effetSec: FIN, schedule: 'sub_sched_ABC123' })
  assert.match(C.texteConfirmationAnnulation(d), /^Tu confirmes que tu restes au forfait de 3 mois \?\n\nLe passage au mois prévu le 27 février 2027 est annulé/)
  assert.match(C.texteAnnulationFaite(d), /reste au forfait de 3 mois, prochain renouvellement le 27 février 2027/)
  const passe = C.decisionAnnulationChangement(prevu, (FIN + J) * 1000)
  assert.equal(passe.motif, 'deja_fait')
})

await bloc('pause ou arret pendant un changement prevu : annuler d abord ; apres la date, rien ne bloque', () => {
  const prevu = etat({ schedule: 'sub_sched_ABC123', meta: notreMeta('mensuel', FIN) })
  assert.match(C.refusPendantChangement(prevu, 'pause', MAINTENANT), /prévu le 27 février 2027\. Pour une pause, il faut d'abord annuler ce changement/)
  assert.match(C.refusPendantChangement(prevu, 'arret', MAINTENANT), /Pour l'arrêt, il faut d'abord annuler ce changement/)
  assert.equal(C.refusPendantChangement(prevu, 'arret', (FIN + 1) * 1000), null)
  assert.equal(C.refusPendantChangement(etat({}), 'pause', MAINTENANT), null)
})

await bloc('mon_abonnement : le changement prevu, vers quoi, quand ; les rappels du forfait', () => {
  const prevu = etat({ schedule: 'sub_sched_ABC123', meta: notreMeta('mensuel', FIN) })
  assert.match(C.phraseChangementPrevu(prevu, MAINTENANT), /^Ton forfait de 3 mois va jusqu'au 27 février 2027, puis ton abonnement passe au mois/)
  assert.deepEqual(C.faitsChangementPrevu(prevu, MAINTENANT), { changement_formule_prevu: { vers: 'mensuel', le: '27 février 2027', annulable: true } })
  assert.equal(C.phraseChangementPrevu(etat({}), MAINTENANT), null)
  assert.deepEqual(C.faitsChangementPrevu(undefined, MAINTENANT), {})
  assert.equal(C.rappelForfait(prevu, MAINTENANT), 'passage_au_mois')
  assert.equal(C.rappelForfait(etat({}), MAINTENANT), 'renouvellement')
  assert.equal(C.texteRappelPassageAuMois(FIN), "Ton forfait de 3 mois se termine le 27 février 2027. Ensuite, ton abonnement passe au mois, à 99 € par mois, comme tu l'as demandé.")
})

await bloc('le calendrier Stripe : phase en cours recopiee jusqu a la date d effet, puis le mensuel, release, sans prorata', () => {
  const phase = {
    start_date: FIN - 91 * J, end_date: FIN + 12 * J, trial_end: FIN + 12 * J,
    items: [{ price: { id: 'price_1UeGf4CbHiN0O0Xi0vQFXXQy' }, quantity: 1, tax_rates: [] }],
    discounts: [{ coupon: 'COUPON1', discount: null, promotion_code: null }],
    default_payment_method: 'pm_123', collection_method: 'charge_automatically',
    default_tax_rates: [], automatic_tax: { enabled: false }, metadata: { report_jours_fait: '1' },
  }
  assert.equal(C.phaseCouranteConforme(phase, FIN + 12 * J), true)
  assert.equal(C.phaseCouranteConforme(phase, FIN), false)
  assert.equal(C.phaseCouranteConforme(undefined, FIN), false)
  const meta = C.metadonneesChangement({ vers: 'mensuel', effetSec: FIN + 12 * J }, 'sub_sched_ABC123', new Date(MAINTENANT))
  assert.deepEqual(meta, {
    changement_formule_par: 'bot-live-club',
    changement_formule_sens: 'forfait_3_mois_vers_mensuel',
    changement_formule_demande_le: '2026-11-27T12:00:00.000Z',
    changement_formule_effet: new Date((FIN + 12 * J) * 1000).toISOString(),
    changement_formule_schedule: 'sub_sched_ABC123',
  })
  const corps = C.corpsCalendrierChangement(phase, { effetSec: FIN + 12 * J, prixCible: C.PRIX_MENSUEL_LIVECLUB }, meta)
  assert.equal(corps.end_behavior, 'release')
  assert.equal(corps.proration_behavior, 'none')
  assert.equal(corps['phases[0][start_date]'], String(FIN - 91 * J))
  assert.equal(corps['phases[0][end_date]'], String(FIN + 12 * J))
  assert.equal(corps['phases[0][trial_end]'], String(FIN + 12 * J), 'l essai n est jamais leve')
  assert.equal(corps['phases[0][items][0][price]'], 'price_1UeGf4CbHiN0O0Xi0vQFXXQy', 'la phase payee garde son prix')
  assert.equal(corps['phases[0][discounts][0][coupon]'], 'COUPON1')
  assert.equal(corps['phases[0][metadata][report_jours_fait]'], '1')
  assert.equal(corps['phases[1][items][0][price]'], 'price_1TdA3RCbHiN0O0XixdHcppnE')
  assert.equal(corps['phases[1][items][0][quantity]'], '1')
  assert.equal(corps['phases[1][iterations]'], '1')
  assert.equal(corps['phases[1][proration_behavior]'], 'none')
  assert.equal(corps['phases[0][default_payment_method]'], 'pm_123')
  assert.equal(corps['phases[1][default_payment_method]'], 'pm_123')
  assert.equal(corps['phases[1][collection_method]'], 'charge_automatically')
  assert.equal(corps['phases[1][discounts][0][coupon]'], undefined, 'pas de remise sur le mensuel a 99 €')
  assert.equal(corps['metadata[changement_formule_par]'], 'bot-live-club')
  assert.ok(!Object.keys(corps).some(k => k.startsWith('phases[2]')))
  // Annulation : nos cinq cles effacees.
  assert.deepEqual(Object.values(C.effacementMetadonneesChangement()), ['', '', '', '', ''])
})

await bloc('journal : le geste changement_formule a sa ligne au fil, sens et date d effet', () => {
  assert.equal(P.phraseGeste({ geste: 'changement_formule', resultat: 'fait', regle: 'demande_membre', details: { etape: 'programmation', sens: 'forfait_3_mois_vers_mensuel', effet_le: '2027-02-27' } }),
    'Changement de formule programmé : passage au mois le 27 février 2027.')
  assert.equal(P.phraseGeste({ geste: 'changement_formule', resultat: 'fait', regle: 'demande_membre', details: { etape: 'annulation' } }),
    "Changement de formule annulé : l'abonnement garde sa formule.")
  assert.equal(P.phraseGeste({ geste: 'changement_formule', resultat: 'echec', regle: 'stripe', details: {} }), null)
  const mig = lire('../src/lib/stripe-actions.ts')
  assert.match(mig, /\| 'changement_formule'/)
})

await bloc('cablage : outils de l agent, consignes, ligne des remises ajustee, fiche live-club', async () => {
  const M = await import('../src/lib/liveclub/prompt-membre.ts')
  const noms = M.OUTILS_MEMBRE.map(o => o.name)
  assert.ok(noms.includes('proposer_changement_formule') && noms.includes('proposer_annuler_changement'))
  const outil = M.OUTILS_MEMBRE.find(o => o.name === 'proposer_changement_formule')
  assert.deepEqual(outil.input_schema.properties.vers.enum, ['mensuel', 'forfait_3_mois'])
  assert.deepEqual(outil.input_schema.required, ['vers'])
  assert.match(outil.description, /N'exécute rien : le membre reçoit un bouton de confirmation/)
  assert.ok(M.SYSTEM_PROMPT_MEMBRE.includes('- proposer_changement_formule : '))
  assert.ok(M.SYSTEM_PROMPT_MEMBRE.includes('- proposer_annuler_changement : '))
  assert.ok(M.SYSTEM_PROMPT_MEMBRE.includes("Un outil proposer_ n'exécute RIEN"))
  assert.ok(!M.SYSTEM_PROMPT_MEMBRE.includes('pas de changement de prix'), 'la ligne des remises n interdit plus le changement de formule')
  assert.match(M.SYSTEM_PROMPT_MEMBRE, /Pas de réduction, pas de code promo, pas de remise sur son prix ni de remboursement : tu n'as aucun outil pour ça\. Changer de formule/)
  assert.ok(!/[—–]/.test(M.SYSTEM_PROMPT_MEMBRE))
  const agent = lire('../src/lib/liveclub/agent-membre.ts')
  assert.match(agent, /proposer_changement_formule: 'changement_formule'/)
  assert.match(agent, /proposer_annuler_changement: 'annuler_changement'/)
  const conv = lire('../src/lib/liveclub/conversations.ts')
  assert.match(conv, /'changement_formule', 'annuler_changement'\]\.includes\(x\.type\)/)
  for (const x of [lire('../docs/connaissances/live-club.md'), lire('../src/lib/connaissances.generated.ts')]) {
    assert.ok(x.includes(C.LIEN_DIRECT_FORFAIT), 'meme lien direct que la fiche')
    assert.ok(x.includes('ne paie pas deux fois : son mensuel s\'arrête tout seul à la fin du mois déjà payé, et les jours restants s\'ajoutent à son forfait'))
    assert.ok(x.includes('qui passe la main à l\'équipe'))
    assert.ok(x.includes('peut demander à l\'agent du Live Club de repasser au mois'))
  }
})

console.log(`\n${n} blocs ok`)
process.exit(0)
