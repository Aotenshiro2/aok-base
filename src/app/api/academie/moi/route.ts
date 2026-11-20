import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireCatalogue, type Catalogue } from '@/lib/academie/catalogue'
import { construire } from '@/lib/academie/vue-moi'
import { compteDuJeton, corsAcademie, entetesAcademie, origineDeLaRequete, refusAcademie, tronquer } from '@/lib/academie/http'
import { etatQuestions, vueQuestions, type EtatQuestions } from '@/lib/academie/questions-entree'
import {
  repriseAutomatique, reperePublic, reperesDuCompte, situationReprise, vueReprise, type BilanAuto, type SituationReprise,
} from '@/lib/academie/reprise'
import { noterConnexion, progressionDuCompte, type ProgressionLecon } from '@/lib/academie/suivi'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'
import { soutienDuCompte, type SoutienDuCompte } from '@/lib/soutien'
import { lireTarifsMembres } from '@/lib/academie/prix-membre'
import { membreDuTarif, prixMembre, tarifPossible, vueTarif, type TarifMembre } from '@/lib/academie/prix-membre-pur'

/**
 * GET /api/academie/moi : tout ce dont les ecrans de l'academie ont besoin,
 * en un appel (PLAN-ACADEMIE.md, sections 8 et 12, V1 point 4) : l'accueil
 * (« Continuer », « Mes cours », « Tous les cours » verrouilles), la page
 * module et le plan des lecons.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>.
 * Reponse 200 :
 *   {
 *     ok: true,
 *     compte: { admin, etm, equipe, vip, live_club, live_club_source, autres_adresses },   live_club : oui, non, inconnu,
 *                           non_lu (pas demande) ;
 *                           equipe (09/11/2026) : statut equipe AOK (estEquipe), live_club vaut alors 'oui' ;
 *                           etm : statut ETM actif ; vip (10/11/2026) : rang Skool vip d'une fiche du cockpit
 *                           reliee au compte. Deux booleens pour la tete de Mon espace (« Élève ETM »,
 *                           « Membre VIP ») : rien d'autre de la fiche ne part au navigateur ;
 *                           live_club_source (10/11/2026) : exemption, broker ou manuel quand live_club vaut
 *                           'oui' par une source sans Stripe (un ETM ou un VIP y est lu aussi), null sinon ;
 *                           autres_adresses (10/11/2026, restes) : le NOMBRE d'adresses de la fiche du cockpit
 *                           reliee au compte confirmees sur aucun compte du site, pour le rappel « Comptes
 *                           lies » de Mon espace (jamais les adresses) ;
 *                           soutien (11/11/2026, src/lib/soutien.ts) : { carnet, pilotage, aok }, true = un abonnement
 *                           de soutien actif sur l'app (badge « Soutien » de Mon espace), aok = un soutien
 *                           AOKnowledge actif (/soutenir, soutien-aok.ts), null = Stripe illisible,
 *                           null entier = lecture en echec ; jamais un identifiant Stripe
 *     incomplet,                            true = une source illisible (Stripe) : des contenus sont « inconnu »
 *     continuer: { lecon, module, reprise_s, derniere_vue_le, acces, etat } | null,   la derniere lecon ouverte
 *     questions_entree: { poser, version, questions: [texte, texte] },   les questions d'entree (30/10/2026,
 *                           questions-entree.ts) : poser = compte non admin qui n'a ni repondu ni passe
 *                           (faux si la table est absente ou illisible : /moi ne tombe jamais pour elles)
 *     reprise: { possible, historique, jusquau, une_fois_par, faites: [{ module_id, section_id, mode, lecons }] } | null,
 *                           le bouton « Deja vu avant » (15/11/2026, reprise.ts) : possible = historique (releve de
 *                           Skool ou ancien membre) ET dans la fenetre ; faites = reprises du membre (le « une fois ») ;
 *                           null = illisible ou migration 20261115180000 absente (pas de bouton, /moi ne tombe pas).
 *                           (15/11 soir) mode : membre (le bouton) ou auto (pre-rempli depuis Skool) ; lecons = le
 *                           nombre de lecons cochees ce jour-la
 *
 * (15/11/2026 soir, brief 2026-11-15-academie-reprise-auto) Avant de lire la progression, /moi RATTACHE le compte a son
 * membre de Skool s'il ne l'est pas (email, puis nom, en recoupant le site et la fiche du cockpit, sans ambiguite) et
 * PRE-REMPLIT les cours de Skool pas encore remplis (reprise.ts, repriseAutomatique, une transaction). Une panne ne
 * fait jamais tomber /moi : un log (le compte tronque et des nombres), et la page sans pre-remplissage.
 *     modules: [{ id, slug, titre, resume, parcours, ordre, statut, auteur, image,
 *                 prix_eur,                 prix du module vendu seul, null = pas vendu seul
 *                 lien_externe,             https vers un autre site (Masterclass) ou null ; rempli =
 *                                           ni lecons ni offres, acces 'entier' sans raison (pas de cadenas),
 *                                           progression a zero : le site fait de la carte un lien
 *                 offres: [{ slug, titre, type, prix_eur, portee, sections }],   ce qui l'ouvre (portee : module,
 *                                           sections = une partie, tout = l'offre ouvre tout, ETM) ;
 *                                           sections (15/11/2026) : les ids des sections ouvertes par
 *                                           une offre de portee 'sections', vide sinon ;
 *                                           tarif (20/11/2026, absent sinon) : { prix_eur, prix_courant_eur,
 *                                           fin_le } quand CE compte, membre du Live Club, a un tarif membre
 *                                           en cours sur l'offre (Black Friday : la partie 2 a 250 au lieu
 *                                           de 850 jusqu'au 30/11 23:59:59 Paris ; les 7 modules vendus a
 *                                           l'unite a moitie prix, Live Club actif seulement : membreDuTarif).
 *                                           Le journal facture le sien.
 *                 acces: entier | partiel | ferme | inconnu, raisons,
 *                 progression: { lecons, vues, en_cours, ouvertes, commencees, pourcentage },
 *                           pourcentage = part des lecons ACCESSIBLES a l'eleve a l'etat 'vu'
 *                           (toutes les publiees s'il n'en a aucune) ; accessibles = leur nombre ;
 *                           commencees = lecons ouvertes au moins une fois (ouvert, en_cours ou vu)
 *                 skool: { pourcentage, terminees, total, releve_le } | null,   (15/11/2026) le repere du releve de
 *                           Skool pour ce module (correspondances sures seulement, plusieurs cours = total des lecons
 *                           terminees sur total des lecons) ; null = aucun releve pour ce module
 *                 sections: [{ id, ordre, titre, acces, raisons, skool }],
 *                 lecons: [{ id, slug, section_id, ordre, titre, type, format, duree_s, apercu, statut,
 *                            lisible, acces, raisons,
 *                            etat: non_vu | ouvert | en_cours | vu,
 *                            progression | null,
 *                            live?: { le, type, organisations, intervenants } }] }]
 *   }
 * live (11/11/2026, Rediffusion des Lives, migration 20261111010000) : la date du live (AAAA-MM-JJ),
 * son type (slug), ses organisations et intervenants (noms affiches). Absent hors des lecons de live
 * et avant la migration.
 * etat (Brice, 15/10) : non_vu = jamais ouverte ; ouvert = lien ou contenu
 * delivre, rien de consomme ; en_cours = du temps reellement regarde ou lu ;
 * vu = 60 % regardes, fin de la video, texte lu jusqu'en bas ou clic
 * (progression.vu_par : mesure, fin, texte_fin, eleve).
 * progression = { reprise_s, position_max_s, secondes_vues, pourcentage,
 *   terminee_le, marquee_vue_le, vu_le, vu_par, derniere_vue_le, vue }.
 * Modules publies ou a venir, lecons publiees ou a venir (lisible = false
 * pour ce qui est annonce). JAMAIS d'identifiant Bunny ou Wistia ni de
 * contenu : seule la route de lecture les delivre, apres le droit.
 * 401 'jeton', 503 'indisponible' (base ou Supabase Auth illisible).
 *
 * Note une connexion dans le journal des lectures (au plus une par 30 min).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'GET, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}


export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/moi] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  // Le badge « Soutien » (11/11/2026) : relu chez Stripe en parallele, borne a 4 s, jamais bloquant.
  const soutien: Promise<SoutienDuCompte | null> = soutienDuCompte(userId).catch(() => null)

  // Les questions d'entree : une panne ou la table absente ne fait jamais tomber /moi (rien n'est pose).
  const questions: Promise<EtatQuestions> = etatQuestions(prisma, userId).catch((err: unknown) => {
    if (!relationAbsente(err)) console.warn(`[academie/moi] questions d'entree illisibles compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return 'indisponible' as const
  })

  // (15/11/2026 soir) Le rattachement a Skool et le pre-remplissage, AVANT la lecture de la progression et du
  // bouton. Une panne (base, migration 20261115200000 absente) ne fait jamais tomber /moi : un log, et on continue.
  const lectureCatalogue = lireCatalogue()
  const auto: Promise<BilanAuto | null> = lectureCatalogue.then(
    cat => repriseAutomatique(userId, cat).then(b => {
      if (b.rattache || b.lecons > 0) {
        console.info(`[academie/moi] reprise auto compte=${tronquer(userId)} rattache=${b.rattache?.mode ?? 'non'}`
          + `${b.rattache ? `/${b.rattache.source}` : ''} cours=${b.cours} lecons=${b.lecons}`)
      }
      return b
    }),
    () => null,
  ).catch((err: unknown) => {
    console.warn(`[academie/moi] reprise auto en echec compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return null
  })

  // (15/11/2026) Le bouton « Deja vu avant » et les reperes de Skool : une panne ou la migration absente ne fait
  // jamais tomber /moi (pas de bouton).
  const reprise: Promise<SituationReprise | null> = auto.then(() => situationReprise(userId)).catch((err: unknown) => {
    if (!relationAbsente(err)) console.warn(`[academie/moi] reprise illisible compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return null
  })

  let droits: DroitsAcademie
  let catalogue: Catalogue
  let progression: Map<string, ProgressionLecon>
  try {
    [droits, catalogue, progression] = await Promise.all([
      droitsAcademie(userId),
      lectureCatalogue,
      auto.then(() => progressionDuCompte(userId)),
    ])
  } catch (err) {
    console.warn(`[academie/moi] lecture impossible compte=${tronquer(userId)} : ${
      relationAbsente(err) ? 'tables academie absentes' : messageErreur(err)}`)
    return refus('indisponible', 503)
  }

  try {
    await noterConnexion(userId, origineDeLaRequete(req))
  } catch (err) {
    console.warn(`[academie/moi] connexion NON notee compte=${tronquer(userId)} : ${messageErreur(err)}`)
  }

  if (droits.incomplet) {
    console.warn(`[academie/moi] droits incomplets compte=${tronquer(userId)} (${droits.erreurs.join(', ')})`)
  }

  const { modules: modulesBruts, continuer } = construire(catalogue, droits, progression)
  const situation = await reprise
  const reperes = situation ? reperesDuCompte(situation, catalogue) : null
  // (20/11/2026) Les tarifs membres en cours (Black Friday) : seulement pour CE compte, membre du Live Club, dans la
  // fenetre ; jamais dans /catalogue ni pour un visiteur. Illisibles (migration absente) : aucun, /moi ne tombe pas.
  const tarifs: TarifMembre[] = await lireTarifsMembres().catch((err: unknown) => {
    console.warn(`[academie/moi] tarifs membres illisibles : ${messageErreur(err)}`)
    return []
  })
  const maintenant = new Date()
  const modules = modulesBruts.map(m => ({
    ...m,
    skool: reperePublic(reperes?.get(`module:${m.id}`)),
    sections: m.sections.map(s => ({ ...s, skool: reperePublic(reperes?.get(`section:${s.id}`)) })),
    offres: m.offres.map(o => {
      if (!tarifs.length || typeof o.prix_eur !== 'number' || !tarifPossible(o.slug, tarifs, maintenant)) return o
      const calcul = prixMembre({ offre: o.slug, prixCourantEur: o.prix_eur, membre: membreDuTarif(droits, o.slug, m.id), tarifs, quand: maintenant })
      const tarif = vueTarif(calcul)
      return tarif ? { ...o, tarif } : o
    }),
  }))
  return NextResponse.json(
    {
      ok: true,
      compte: {
        admin: droits.admin, etm: droits.etm, equipe: droits.equipe, vip: droits.vip, live_club: droits.liveClub,
        live_club_source: droits.sourceLiveClub,
        autres_adresses: droits.autresAdresses,
        soutien: await soutien,
      },
      incomplet: droits.incomplet,
      continuer,
      modules,
      questions_entree: vueQuestions(await questions, droits.admin),
      reprise: situation ? vueReprise(situation) : null,
    },
    { headers },
  )
}
