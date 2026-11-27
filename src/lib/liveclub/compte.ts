// Le Live Club d'un compte du site, lu par TOUS ses emails connus (27/11/2026,
// correctif des bonus membres, audit du 27/11 trous 1 a 3). Regles pures :
// compte-pur.ts.
//
// Deux lecteurs :
//   - droitsAcademie (academie/droits.ts) : les contenus du Live Club et les
//     prix membres du Black Friday ;
//   - checkMentoratAccess (entitlements.ts) : le Carnet et Pilotage Premium,
//     qui ne lisaient que la vue du cockpit (le Premium arrivait le lendemain).
//
// Meme lecture que droitLiveClub (liveclub/droits.ts, le bot) : exemption,
// acces broker, acces manuel, puis Stripe MelTrade EN DIRECT
// (abonnementsLiveClubParEmail et abonnementsLiveClubDuClient,
// meilleurAbonnement : trialing compris, plusieurs abonnements, fin payee
// d'un abonnement termine). Plus le filet du cockpit (cockpit_abonnements,
// SQL_FAITS_COCKPIT.abonnement_cockpit), lu AVANT Stripe : il donne 'oui'
// sans appel (avant le 27/11 il etait lu apres, le resultat est le meme).
//
// Les emails connus (compte-pur.ts, emailsDuCompte) : verifies du compte,
// puis ceux de sa fiche du cockpit, puis ceux de ses rattachements Live Club
// actifs (et leurs clients Stripe du compte melanie). Jamais un email saisi.
//
// Delai et cache (repris d'academie/droits.ts, deplaces ici le 27/11) : 4 s
// au plus par lecture Stripe, en parallele ; cache par email ou par client
// (oui 10 min, non 5 min, 500 entrees) ; un delai ou une erreur rend
// 'inconnu', sans cache. liveClubDuCompte ne jette jamais.

import { prisma } from '@/lib/db'
import { SQL_FAITS_COCKPIT } from '@/lib/academie/requetes'
import { CacheCourt, sourceSansStripe, type SourceLiveClub } from '@/lib/academie/pur'
import { abonnementsLiveClubDuClient, abonnementsLiveClubParEmail, type AbonnementResume } from './stripe'
import { lireProduitsLiveClub } from './produits'
import { meilleurAbonnement } from './pur'
import {
  avecDelai, clientsDuCompte, conclureLiveClubCompte, emailsDuCompte, etatDesAbonnements, type EtatLu, type LiveClubCompte,
} from './compte-pur'

export const STRIPE_DELAI_MS = 4000
const CACHE_OUI_MS = 10 * 60 * 1000
const CACHE_NON_MS = 5 * 60 * 1000
const cacheStripe = new CacheCourt<boolean>(500)
const erreursSignalees = new Set<string>()

function signalerUneFois(code: string, message: string) {
  if (erreursSignalees.has(code)) return
  erreursSignalees.add(code)
  console.warn(`[liveclub/compte] ${message} (signale une seule fois par instance)`)
}

async function lireStripe(cle: string, lire: () => Promise<AbonnementResume[]>): Promise<EtatLu> {
  const enCache = cacheStripe.lire(cle)
  if (enCache !== undefined) return enCache ? 'oui' : 'non'
  try {
    const abonnements = await avecDelai(lire(), STRIPE_DELAI_MS)
    const trouve = meilleurAbonnement(abonnements) !== null
    // Comme droitLiveClub : sans la liste complete des produits Live Club, pas de 'non'.
    const etat = etatDesAbonnements(trouve, trouve ? true : (await lireProduitsLiveClub()).complete)
    if (etat === 'inconnu') signalerUneFois('produits', 'liste des produits Live Club incomplete : Live Club inconnu')
    else cacheStripe.ecrire(cle, etat === 'oui', etat === 'oui' ? CACHE_OUI_MS : CACHE_NON_MS)
    return etat
  } catch (err) {
    const nom = err instanceof Error ? err.name : 'erreur'
    // Jamais le message : il peut reprendre la requete (et donc l'email).
    signalerUneFois(`stripe:${nom}`, nom === 'DelaiDepasse'
      ? `Stripe MelTrade n'a pas repondu en ${STRIPE_DELAI_MS} ms : Live Club inconnu, sans cache`
      : `Stripe MelTrade illisible (${nom}) : Live Club inconnu, sans cache`)
    return 'inconnu'
  }
}

/** Le Live Club chez Stripe MelTrade pour un email (normalise par l'appelant). */
export const liveClubParEmail = (email: string): Promise<EtatLu> =>
  lireStripe(`e:${email}`, () => abonnementsLiveClubParEmail(email))

/** Le Live Club chez Stripe MelTrade pour un client du compte melanie (cus_...). */
export const liveClubParClient = (client: string): Promise<EtatLu> =>
  lireStripe(`c:${client}`, () => abonnementsLiveClubDuClient(client))

/**
 * $1 = emails verifies du compte (text[]). Ce qui relie le compte a d'autres
 * adresses, par des liens poses par nous :
 * - emails_fiche : les adresses des fiches du cockpit (cockpit_membre_emails)
 *   qui portent un de ces emails, le principal et le verifie d'abord, 10 au plus ;
 * - emails_rattachement, clients : l'email et le client Stripe (compte
 *   melanie ou inconnu, comme droitLiveClub) des rattachements Live Club
 *   ACTIFS de ces fiches ou de ces emails ;
 * - exempte_telegram, broker_telegram : une exemption active ou un acces
 *   broker actif poses sur le compte Telegram d'un de ces rattachements (le
 *   bot les lit par telegram_id ; SQL_FAITS_COCKPIT ne les lit que par email).
 */
export const SQL_LIVECLUB_COMPTE = `
with fiches as (
  select distinct me.membre_id::text as membre_id
    from public.cockpit_membre_emails me
   where lower(btrim(me.email)) = any($1::text[])
),
ratt as (
  select r.telegram_id, r.email, r.client_stripe, r.compte
    from public.cockpit_liveclub_rattachements r
   where r.retire_le is null
     and (r.membre_id::text in (select membre_id from fiches) or lower(btrim(r.email)) = any($1::text[]))
)
select
  coalesce(array(
    select x.e from (
      select lower(btrim(me.email)) as e, bool_or(me.principal) as p, bool_or(me.verifie) as v
        from public.cockpit_membre_emails me
       where me.membre_id::text in (select membre_id from fiches) and position('@' in me.email) > 1
       group by 1
    ) x
    order by x.p desc nulls last, x.v desc nulls last, x.e
    limit 10
  ), '{}'::text[]) as emails_fiche,
  coalesce(array(
    select distinct lower(btrim(ratt.email)) from ratt where ratt.email is not null and position('@' in ratt.email) > 1
  ), '{}'::text[]) as emails_rattachement,
  coalesce(array(
    select distinct ratt.client_stripe from ratt
     where ratt.client_stripe is not null and (ratt.compte is null or ratt.compte = 'melanie')
  ), '{}'::text[]) as clients,
  exists (
    select 1 from public.cockpit_liveclub_exemptions x
     where x.retire_le is null and (x.jusquau is null or x.jusquau >= current_date)
       and x.telegram_id in (select ratt.telegram_id from ratt where ratt.telegram_id is not null)
  ) as exempte_telegram,
  exists (
    select 1 from public.cockpit_liveclub_acces a
     where a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date
       and a.telegram_id in (select ratt.telegram_id from ratt where ratt.telegram_id is not null)
  ) as broker_telegram
`

type LigneConnus = {
  emails_fiche: string[] | null
  emails_rattachement: string[] | null
  clients: string[] | null
  exempte_telegram: boolean | null
  broker_telegram: boolean | null
}

/** Les colonnes de SQL_FAITS_COCKPIT que lit le Live Club. */
export type FaitsLiveClub = {
  exempte?: boolean | null
  broker_jusquau?: string | null
  manuel_jusquau?: string | null
  abonnement_cockpit?: boolean | null
}

export type LectureLiveClubCompte = LiveClubCompte & {
  /** Sources illisibles (codes courts, sans donnee personnelle). */
  erreurs: string[]
  /** La source sans Stripe du 'oui', ou null (abonnement Stripe, filet cockpit, pas de Live Club). */
  sansStripe: SourceLiveClub | null
}

const memesEmails = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every(e => b.includes(e))

/**
 * Le Live Club d'un compte par tous ses emails connus. emailsVerifies : ceux
 * de SQL_IDENTITE (verifies, minuscules). faitsVerifies : SQL_FAITS_COCKPIT
 * deja lu sur ces emails par l'appelant (reutilise si la liste ne s'agrandit
 * pas). Ne jette jamais : une lecture ratee rend 'inconnu' si rien ne dit oui.
 */
export async function liveClubDuCompte(
  emailsVerifies: readonly string[],
  opts: { faitsVerifies?: FaitsLiveClub | null } = {},
): Promise<LectureLiveClubCompte> {
  const erreurs: string[] = []
  let connus: LigneConnus | undefined
  try {
    connus = (await prisma.$queryRawUnsafe<LigneConnus[]>(SQL_LIVECLUB_COMPTE, [...emailsVerifies]))[0]
  } catch {
    erreurs.push('emails_connus: illisibles')
    signalerUneFois('connus', 'emails connus du compte illisibles : verifies seulement')
  }
  const emails = emailsDuCompte({ verifies: emailsVerifies, fiche: connus?.emails_fiche, rattachements: connus?.emails_rattachement })
  const clients = clientsDuCompte(connus?.clients ?? [])

  let faits: FaitsLiveClub | null = null
  if (opts.faitsVerifies !== undefined && memesEmails(emails, emailsVerifies)) {
    faits = opts.faitsVerifies
  } else if (emails.length) {
    try {
      faits = (await prisma.$queryRawUnsafe<FaitsLiveClub[]>(SQL_FAITS_COCKPIT, emails))[0] ?? null
    } catch {
      erreurs.push('faits_cockpit: illisibles')
      signalerUneFois('faits', 'faits du cockpit illisibles pour les emails connus')
    }
  }
  const sansStripe: SourceLiveClub | null = sourceSansStripe(faits)
    ?? (connus?.exempte_telegram === true ? 'exemption' : connus?.broker_telegram === true ? 'broker' : null)
  const filetCockpit = faits?.abonnement_cockpit === true
  if (sansStripe || filetCockpit) {
    return { ...conclureLiveClubCompte({ sansStripe, filetCockpit, stripe: [] }), erreurs, sansStripe }
  }

  const stripe = await Promise.all([...emails.map(liveClubParEmail), ...clients.map(liveClubParClient)])
  if (stripe.includes('inconnu')) erreurs.push('liveclub: stripe illisible')
  const r = conclureLiveClubCompte({ sansStripe: null, filetCockpit: false, stripe, lectureIncomplete: erreurs.length > 0 })
  return { ...r, erreurs, sansStripe: null }
}
